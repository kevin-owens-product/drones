# Factory-to-flight digital thread and readiness forecast

This is the first slice of two bets. The first gives each airframe serial a birth record that carries its airworthiness reason into the Operate console. The second forecasts how many airframes a unit can put up tomorrow.

## Birth record

`services/api/src/a2e/birth.py` holds one record per serial. It lists the parts lots, the calibration results with their limits, the firmware SHA-256, the end-of-line (EOL) bench or hover test result, and a timestamp that includes a timezone.

`validate` lists the problems that make a record unusable. `verdict` returns a status and a reason that an operator can read:

- If the record is invalid, the status is `unknown` and the reason is "Birth record invalid: ...".
- If the EOL test failed, the status is `grounded` and the reason names the first out-of-range calibration, for example "EOL hover test failed: IMU cal out of range". If no calibration is out of range, the reason uses the test note.
- If a calibration is out of range but the test passed, the status is still `grounded`.
- Otherwise the status is `airworthy`.

Migration `0007_birth_records.sql`, with a matching alembic version, adds a `birth_records` table under fleet row-level security. The next free number was 0007, not 0005, because 0005 and 0006 already exist. Nothing writes to the table yet, and the platforms API does not return a reason yet.

## Console

`readiness.ts` now shows the vehicle's `airworthiness_reason` in the Airworthiness check when one is present. Go and no-go behave as before: restricted or grounded means NO-GO. `vehicle.ts` gained one optional field so that the reason reaches readiness.

In the demo server, pad vehicle NX-12 is grounded with the reason "EOL hover test failed: IMU cal out of range". It stays NO-GO after it gets a position fix. The console only advises; it never arms or launches anything (ADR 0016).

## Forecast

`services/api/src/a2e/forecast.py` works out pack health and a ready-tomorrow count:

- **State of health** is measured capacity divided by rated capacity.
- **Fade per cycle** is the health lost so far divided by the cycle count.
- **Cycles left** is the smaller of two numbers: the cycles until health reaches the 0.80 floor, and the cycles until the 300-cycle limit.
- **Attrition** is losses per sortie from the unit's own history, with a 90% Wilson interval.

`ready_tomorrow` multiplies today's ready airframes by the survival rate over the planned sorties. It returns an expected count plus a low and high count, using the high and low ends of the attrition interval. Pack supply caps the result: today's cycles are spread over the usable packs, and each airframe needs two packs that still have cycles left after today. The result also says whether attrition or packs set the limit.

## How to run

- `cd services/api && pip install -e '.[dev]' && python -m pytest tests/unit -q`. The new tests are in `test_birth_forecast.py`.
- `cd services/ui && npm run typecheck`, then `npm run build && node demo/server.mjs`, and look at NX-12 on the pad.

## What it measures

The following come from unit checks with synthetic inputs, not field data:

- 12 ready airframes, 3 sorties each, and 2 losses in 100 sorties give an expected 11.29, with a low of 10 and a high of 11.
- The attrition interval for 2 losses in 100 sorties is 0.0066 to 0.0587.

## Limits

- Fade is assumed to be linear in cycles. Real packs fade faster near end of life.
- Attrition is treated as one rate for every sortie type and every airframe.
- No API route serves birth records or forecasts yet, and the factory station does not post records yet.
- Packs are treated as interchangeable within a unit. Chargers and charge time are not modelled.
- `unknown` airworthiness still counts as GO in the console, as it did before. That is unchanged so that fleets with no records yet are not blocked.
