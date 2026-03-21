StrategyLoader
   ↓ init(this) when engine starts
   ↓ loads files → creates instances → state = STAGED
   ↓ user / API calls loader.startStrategy(id)
         ↓ sets mode/timeframe
         ↓ state → WARMING_UP
         ↓ calls engine.registerStrategy(strategy)
                   ↓ engine subscribes symbols
                   ↓ engine warmups
                   ↓ engine sets state ACTIVE / ERROR
                   ↓ engine updates broker symbols
   ↓ user calls loader.stopStrategy(id)
         ↓ state → STOPPING → OFFLINE
         ↓ calls engine.unregisterStrategy(id)
                   ↓ engine removes subscriptions
                   ↓ engine updates broker