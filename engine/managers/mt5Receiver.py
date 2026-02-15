import asyncio
import json
import os
import time
from dataclasses import dataclass, field
from typing import Any, Dict, Optional

try:
    import MetaTrader5 as mt5
except Exception:
    mt5 = None

try:
    from dotenv import load_dotenv
except Exception:
    load_dotenv = None

try:
    import websockets
except Exception as exc:
    raise RuntimeError("Missing dependency: websockets") from exc


@dataclass
class ReceiverConfig:
    ws_url: str
    bridge_secret: str
    receiver_id: str
    terminal: str
    account_id: str
    heartbeat_sec: int = 5
    snapshot_sec: int = 10
    reconnect_sec: int = 3
    duplicate_ttl_sec: int = 3600
    dry_run: bool = False


@dataclass
class ReceiverState:
    connected: bool = False
    authorized: bool = False
    last_heartbeat: float = 0
    seen_ids: Dict[str, float] = field(default_factory=dict)


def _log(level: str, message: str) -> None:
    ts = time.strftime("%Y-%m-%d %H:%M:%S")
    print(f"{ts} [MT5_RECEIVER][{level}] {message}")


def _load_config() -> ReceiverConfig:
    if load_dotenv:
        load_dotenv(".env.receiver")

    ws_url = os.getenv("ENGINE_WS_URL", "ws://localhost:3000/mt5").strip()
    bridge_secret = os.getenv("BRIDGE_SECRET", "").strip()
    receiver_id = os.getenv("RECEIVER_ID", "py_receiver").strip()
    terminal = os.getenv("MT5_SERVER", "MT5").strip()
    account_id = os.getenv("MT5_LOGIN", "").strip()
    heartbeat_sec = int(os.getenv("HEARTBEAT_SEC", "5"))
    snapshot_sec = int(os.getenv("SNAPSHOT_SEC", "10"))
    reconnect_sec = int(os.getenv("RECONNECT_SEC", "3"))
    duplicate_ttl_sec = int(os.getenv("DUPLICATE_TTL_SEC", "3600"))
    dry_run = os.getenv("DRY_RUN", "false").strip().lower() in ("1", "true", "yes", "on")

    if not bridge_secret:
        _log("ERROR", "BRIDGE_SECRET missing. Update .env.receiver")

    return ReceiverConfig(
        ws_url=ws_url,
        bridge_secret=bridge_secret,
        receiver_id=receiver_id,
        terminal=terminal,
        account_id=account_id,
        heartbeat_sec=heartbeat_sec,
        snapshot_sec=snapshot_sec,
        reconnect_sec=reconnect_sec,
        duplicate_ttl_sec=duplicate_ttl_sec,
        dry_run=dry_run,
    )


def _init_mt5(cfg: ReceiverConfig) -> bool:
    if mt5 is None:
        _log("WARN", "MetaTrader5 package not available. Running in dry-run mode.")
        return False

    login = int(cfg.account_id) if cfg.account_id else None
    password = os.getenv("MT5_PASSWORD", "").strip()
    server = cfg.terminal

    ok = mt5.initialize(login=login, password=password, server=server)
    if not ok:
        _log("ERROR", f"MT5 initialize failed: {mt5.last_error()}")
        return False
    _log("INFO", "MT5 initialized")
    return True


def _account_snapshot() -> Dict[str, Any]:
    if mt5 is None:
        return {}
    info = mt5.account_info()
    if info is None:
        return {}
    return info._asdict()


def _positions_snapshot() -> list:
    if mt5 is None:
        return []
    positions = mt5.positions_get()
    if not positions:
        return []
    return [p._asdict() for p in positions]


def _market_open(symbol: str) -> bool:
    if mt5 is None:
        return False
    info = mt5.symbol_info(symbol)
    if info is None:
        return False
    if not info.visible:
        mt5.symbol_select(symbol, True)
    return bool(info.trade_mode)


def _has_position(symbol: str) -> bool:
    if mt5 is None:
        return False
    positions = mt5.positions_get(symbol=symbol)
    return bool(positions)


def _check_margin(request: Dict[str, Any]) -> Optional[str]:
    if mt5 is None:
        return None
    result = mt5.order_check(request)
    if result is None:
        return "MARGIN_CHECK_FAILED"
    if result.retcode != mt5.TRADE_RETCODE_DONE:
        return f"MARGIN_{result.comment or result.retcode}"
    return None


def _build_order_request(symbol: str, side: str, lot: float, sl: float, tp: float) -> Dict[str, Any]:
    if mt5 is None:
        return {}
    tick = mt5.symbol_info_tick(symbol)
    if tick is None:
        return {}
    order_type = mt5.ORDER_TYPE_BUY if side == "BUY" else mt5.ORDER_TYPE_SELL
    price = tick.ask if side == "BUY" else tick.bid
    request = {
        "action": mt5.TRADE_ACTION_DEAL,
        "symbol": symbol,
        "volume": lot,
        "type": order_type,
        "price": price,
        "sl": sl or 0.0,
        "tp": tp or 0.0,
        "deviation": 20,
        "type_time": mt5.ORDER_TIME_GTC,
        "type_filling": mt5.ORDER_FILLING_IOC,
    }
    return request


async def _send(ws, payload: Dict[str, Any]) -> None:
    await ws.send(json.dumps(payload))


def _normalize_signal(msg: Dict[str, Any]) -> Dict[str, Any]:
    payload = msg.get("payload") if msg.get("type") == "order_request" else msg
    action = payload.get("action") or payload.get("type") or payload.get("intent")
    action = str(action or "").upper()
    side = str(payload.get("side") or payload.get("direction") or payload.get("type") or "").upper()

    if action in ("OPENPOSITION", "OPEN") and side in ("BUY", "SELL"):
        action = "OPEN"
    if action in ("BUY", "SELL"):
        action = "OPEN"
        side = action

    return {
        "requestId": msg.get("requestId") or payload.get("id"),
        "action": action,
        "symbol": str(payload.get("symbol") or "").upper(),
        "lot": float(payload.get("volume") or payload.get("lot") or payload.get("qty") or 0),
        "sl": float(payload.get("sl") or 0),
        "tp": float(payload.get("tp") or 0),
        "side": side,
        "raw": payload
    }


def _is_duplicate(state: ReceiverState, trade_id: str, ttl: int) -> bool:
    now = time.time()
    expired = [k for k, ts in state.seen_ids.items() if now - ts > ttl]
    for k in expired:
        del state.seen_ids[k]
    if trade_id in state.seen_ids:
        return True
    state.seen_ids[trade_id] = now
    return False


async def _handle_order(ws, state: ReceiverState, cfg: ReceiverConfig, msg: Dict[str, Any]) -> None:
    data = _normalize_signal(msg)
    request_id = data["requestId"] or f"req_{int(time.time()*1000)}"
    symbol = data["symbol"]
    lot = data["lot"]
    sl = data["sl"]
    tp = data["tp"]
    action = data["action"]
    side = data["side"]

    if not symbol or lot <= 0 or action not in ("OPEN", "CLOSE", "CLOSEALL"):
        await _send(ws, {
            "type": "order_result",
            "requestId": request_id,
            "ok": False,
            "error": "INVALID_PAYLOAD"
        })
        return

    if _is_duplicate(state, request_id, cfg.duplicate_ttl_sec):
        await _send(ws, {
            "type": "order_result",
            "requestId": request_id,
            "ok": False,
            "error": "DUPLICATE_REQUEST"
        })
        return

    if cfg.dry_run or mt5 is None:
        await _send(ws, {
            "type": "order_result",
            "requestId": request_id,
            "ok": True,
            "payload": {"status": "executed", "ticket": None, "id": request_id, "dryRun": True}
        })
        return

    if not _market_open(symbol):
        await _send(ws, {
            "type": "order_result",
            "requestId": request_id,
            "ok": False,
            "error": "MARKET_CLOSED"
        })
        return

    if action == "OPEN" and _has_position(symbol):
        await _send(ws, {
            "type": "order_result",
            "requestId": request_id,
            "ok": False,
            "error": "POSITION_EXISTS"
        })
        return

    if action == "OPEN":
        if side not in ("BUY", "SELL"):
            await _send(ws, {
                "type": "order_result",
                "requestId": request_id,
                "ok": False,
                "error": "SIDE_REQUIRED"
            })
            return
        request = _build_order_request(symbol, side, lot, sl, tp)
        if not request:
            await _send(ws, {
                "type": "order_result",
                "requestId": request_id,
                "ok": False,
                "error": "REQUEST_BUILD_FAILED"
            })
            return
        margin_err = _check_margin(request)
        if margin_err:
            await _send(ws, {
                "type": "order_result",
                "requestId": request_id,
                "ok": False,
                "error": margin_err
            })
            return
        result = mt5.order_send(request)
        if result is None or result.retcode != mt5.TRADE_RETCODE_DONE:
            err = result.comment if result else "ORDER_SEND_FAILED"
            await _send(ws, {
                "type": "order_result",
                "requestId": request_id,
                "ok": False,
                "error": err
            })
            return
        await _send(ws, {
            "type": "order_result",
            "requestId": request_id,
            "ok": True,
            "payload": {"status": "executed", "ticket": result.order, "id": request_id}
        })
        return

    if action in ("CLOSE", "CLOSEALL"):
        positions = mt5.positions_get(symbol=symbol) if action == "CLOSE" else mt5.positions_get()
        if not positions:
            await _send(ws, {
                "type": "order_result",
                "requestId": request_id,
                "ok": False,
                "error": "NO_POSITIONS"
            })
            return
        closed = 0
        for pos in positions:
            pos_dict = pos._asdict()
            pos_side = "BUY" if pos_dict["type"] == mt5.POSITION_TYPE_BUY else "SELL"
            close_side = "SELL" if pos_side == "BUY" else "BUY"
            request = _build_order_request(symbol=pos_dict["symbol"], side=close_side, lot=pos_dict["volume"], sl=0, tp=0)
            request["position"] = pos_dict["ticket"]
            result = mt5.order_send(request)
            if result and result.retcode == mt5.TRADE_RETCODE_DONE:
                closed += 1
        await _send(ws, {
            "type": "order_result",
            "requestId": request_id,
            "ok": closed > 0,
            "payload": {"status": "executed", "closed": closed, "id": request_id}
        })


async def _heartbeat_loop(ws, cfg: ReceiverConfig, state: ReceiverState) -> None:
    while state.connected:
        await _send(ws, {"type": "heartbeat"})
        state.last_heartbeat = time.time()
        await asyncio.sleep(cfg.heartbeat_sec)


async def _snapshot_loop(ws, cfg: ReceiverConfig, state: ReceiverState) -> None:
    while state.connected:
        if mt5 is not None:
            await _send(ws, {"type": "account", "payload": _account_snapshot()})
            await _send(ws, {"type": "positions", "payload": _positions_snapshot()})
        await asyncio.sleep(cfg.snapshot_sec)


async def _run_receiver(cfg: ReceiverConfig) -> None:
    state = ReceiverState()
    mt5_ok = _init_mt5(cfg)
    if not mt5_ok:
        cfg.dry_run = True

    while True:
        try:
            _log("INFO", f"Connecting to {cfg.ws_url}")
            async with websockets.connect(cfg.ws_url) as ws:
                state.connected = True
                state.authorized = False

                await _send(ws, {
                    "type": "handshake",
                    "payload": {
                        "token": cfg.bridge_secret,
                        "receiverId": cfg.receiver_id,
                        "terminal": cfg.terminal,
                        "accountId": cfg.account_id
                    }
                })

                async for raw in ws:
                    msg = json.loads(raw)
                    msg_type = msg.get("type")

                    if msg_type == "handshake_ack":
                        if msg.get("ok"):
                            state.authorized = True
                            _log("INFO", "Handshake OK")
                            asyncio.create_task(_heartbeat_loop(ws, cfg, state))
                            asyncio.create_task(_snapshot_loop(ws, cfg, state))
                        else:
                            _log("ERROR", f"Handshake failed: {msg.get('error')}")
                            await ws.close()
                            break

                    elif msg_type == "order_request":
                        if not state.authorized:
                            await _send(ws, {"type": "order_result", "requestId": msg.get("requestId"), "ok": False, "error": "UNAUTHORIZED"})
                            continue
                        await _handle_order(ws, state, cfg, msg)
                    else:
                        # Ignore unknown messages
                        pass

        except Exception as exc:
            _log("WARN", f"Connection error: {exc}")
        finally:
            state.connected = False
            state.authorized = False
            await asyncio.sleep(cfg.reconnect_sec)


def main() -> None:
    cfg = _load_config()
    asyncio.run(_run_receiver(cfg))


if __name__ == "__main__":
    main()
