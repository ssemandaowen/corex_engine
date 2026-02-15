//+------------------------------------------------------------------+
//| CorexReceiver.mq5                                                |
//| Minimal MT5 EA: poll HTTP for next order and confirm fill        |
//+------------------------------------------------------------------+
#property strict

#include <Trade/Trade.mqh>

CTrade trade;

input string CorexUrl = "http://localhost:3000/api/mt5";
input string CorexToken = "REPLACE_WITH_TOKEN";

string EagleSymbol = "Eagle";
string TerminalId = "MT5_LOCAL";
string AccountId = "";
datetime lastHeartbeat = 0;

int OnInit()
{
   EventSetTimer(1); // 1000ms
   return(INIT_SUCCEEDED);
}

void OnDeinit(const int reason)
{
   EventKillTimer();
}

void OnTimer()
{
   Heartbeat();

   string url = CorexUrl + "/next-order";
   string headers = "x-corex-token: " + CorexToken + "\r\nx-terminal-id: " + TerminalId + "\r\n";
   char result[];
   string result_headers;

   int status = WebRequest("GET", url, headers, 5000, NULL, 0, result, result_headers);
   if(status == -1)
   {
      Print("WebRequest error: ", GetLastError());
      ResetLastError();
      return;
   }

   if(status == 404) return;
   if(status != 200)
   {
      Print("Unexpected status: ", status);
      return;
   }

   string body = CharArrayToString(result);
   string orderId = JsonValue(body, "id");
   string symbol = JsonValue(body, "symbol");
   string side = JsonValue(body, "side");
   double qty = StringToDouble(JsonValue(body, "quantity"));

   if(symbol != EagleSymbol) return;
   if(orderId == "" || side == "" || qty <= 0) return;

   bool ok = false;
   if(side == "BUY")
      ok = trade.Buy(qty, symbol);
   else if(side == "SELL")
      ok = trade.Sell(qty, symbol);

   if(!ok)
   {
      Print("Trade failed: ", trade.ResultRetcode(), " ", trade.ResultComment());
      return;
   }

   string confirmUrl = CorexUrl + "/confirm-fill";
   string dealId = IntegerToString((long)trade.ResultDeal());
   double fillPrice = trade.ResultPrice();

   string payload =
      "{"
      "\"order_id\":\"" + orderId + "\","
      "\"deal_id\":\"" + dealId + "\","
      "\"fill_price\":" + DoubleToString(fillPrice, 5) +
      "}";

   char data[];
   StringToCharArray(payload, data);

   string postHeaders = "Content-Type: application/json\r\nx-corex-token: " + CorexToken + "\r\n";
   char postResult[];
   string postResultHeaders;

   int postStatus = WebRequest("POST", confirmUrl, postHeaders, 5000, data, ArraySize(data) - 1, postResult, postResultHeaders);
   if(postStatus != 200)
      Print("Confirm failed: ", postStatus, " ", CharArrayToString(postResult));
}

void Heartbeat()
{
   datetime nowTs = TimeCurrent();
   if (lastHeartbeat != 0 && (nowTs - lastHeartbeat) < 30) return;
   lastHeartbeat = nowTs;

   string url = "http://localhost:3000/api/bridge/heartbeat";
   string headers = "Content-Type: application/json\r\nx-corex-token: " + CorexToken + "\r\n";
   if (AccountId == "")
      AccountId = IntegerToString((long)AccountInfoInteger(ACCOUNT_LOGIN));
   string payload = "{\"terminal_id\":\"" + TerminalId + "\",\"account_id\":\"" + AccountId + "\"}";
   char data[];
   StringToCharArray(payload, data);

   char result[];
   string result_headers;
   int status = WebRequest("POST", url, headers, 5000, data, ArraySize(data) - 1, result, result_headers);
   if(status == -1)
   {
      Print("Heartbeat WebRequest error: ", GetLastError());
      ResetLastError();
      return;
   }
   if(status != 200)
      Print("Heartbeat failed: ", status, " ", CharArrayToString(result));
}

// Minimal JSON extraction (flat keys only)
string JsonValue(string json, string key)
{
   string pattern = "\"" + key + "\"";
   int pos = StringFind(json, pattern, 0);
   if(pos < 0) return "";
   pos = StringFind(json, ":", pos);
   if(pos < 0) return "";
   pos++;
   while(pos < StringLen(json) && (StringGetCharacter(json, pos) == ' ' || StringGetCharacter(json, pos) == '\"'))
      pos++;

   int end = pos;
   while(end < StringLen(json))
   {
      ushort c = StringGetCharacter(json, end);
      if(c == '\"' || c == ',' || c == '}' || c == '\n' || c == '\r')
         break;
      end++;
   }
   return StringSubstr(json, pos, end - pos);
}
