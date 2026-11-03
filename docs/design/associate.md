# Two-stage box association

`onboard/associate` keeps identities for boxes across frames. A box scoring at least 0.5 is matched to an existing track when the intersection-over-union is at least 0.3. Boxes between 0.1 and 0.5 are matched only to tracks the high-score pass left free, and they do not start a new track. Eight frames with no match drop a track.

Two boxes that start 40 pixels apart and each move 2 pixels keep their ids. A following frame at score 0.2 on the same box keeps the id. A lone 0.2 box starts nothing.

This is the association rule from ByteTrack. There is no YOLO detector and no camera frames.
