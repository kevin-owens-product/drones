# Training in the console, and the integration layer

Two first slices: train operators in the real console (bet 7), and an open interface for vehicles that are not PX4 (bet 10). The integration part is described in `integration.md`.

## Training mode

The demo server can run a scripted scenario on top of the synthetic sortie. Open the console with `?scenario=qual-1` and a training panel appears in the lower right. It shows alerts as they fire, lets the operator record a response, and shows a scorecard.

Scenario `qual-1` raises three alerts, timed from when the panel starts the session:

| At | Tail | Alert | Expected response |
| --- | --- | --- | --- |
| 5 s | NX-03 | link lost | confirm failsafe |
| 20 s | NX-04 | GNSS rejected | confirm VIO |
| 35 s | NX-06 | low battery | plan recovery |

Responses are decisions recorded for scoring: monitor, confirm failsafe, confirm VIO, plan recovery, ground next sortie. None of them sends anything to a vehicle. The console monitors and advises (ADR 0016).

Endpoints on the demo server:

- `GET /v1/training/start?scenario=qual-1` starts or restarts the session.
- `GET /v1/training/state` returns raised alerts and the scorecard.
- `POST /v1/training/ack` with `{"id": "a1", "action": "confirm_failsafe"}` records a response once per alert.
- `GET /v1/training/scorecard` returns the scorecard alone.

## What it measures

Time to act per alert (seconds from the alert being raised to the response) and the correct-response rate over acknowledged alerts, plus mean and max time to act. These feed the north star: an operator who acts on alerts quickly and correctly can supervise more sorties per hour.

## How to run

    cd services/ui && npm ci && npm run build && node demo/server.mjs
    # open http://localhost:4173/?scenario=qual-1
    node --test demo/training.test.mjs

The unit check feeds fixed timestamps and checks the scorecard arithmetic (times 4, 6 and 2 s give mean 4 s and max 6 s; two of three correct gives 0.67). That is a check of the code, not a measurement of any operator.

## Limits

- The alerts are text only. The telemetry of NX-03, NX-04 and NX-06 does not change when they fire.
- One session per demo server; a second browser shares it.
- Scorecards are kept in memory and lost on restart.
- No operator has been scored yet. There are no field or trainee numbers.
