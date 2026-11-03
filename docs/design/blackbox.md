# Betaflight blackbox ingest

`a2e.flight.blackbox` reads a `.bfl` written by Betaflight. The fixture `services/api/tests/fixtures/betaflight/sitl.bfl` was copied from `LOG00001.BFL` in the SITL container after the CLI was set to `blackbox_device = VIRTUAL` and `blackbox_mode = ALWAYS`. The firmware line in that file is Betaflight 2026.12.0 `(21e67d203)`.

Intra frames are every 32 loop iterations. The decoder walks inter frames, slow frames, and events so the intra stream stays aligned. On this capture the loop counter advances by 32, time is monotonic, and the motors sit at the header minimum of 1055. Roll gyro is 0 for the whole file because the SITL was disarmed and no simulator attitude was fed in. The debrief page draws that series.

The route only opens a file inside the fixture directory.
