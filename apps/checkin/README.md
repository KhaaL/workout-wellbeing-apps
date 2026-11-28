# Check-in: intended use

Today holds everything. Every tap saves.

## What Today records

| Item | Values | Good end |
|---|---|---|
| Sleep hours | <4, 4-5, 5-6, 6-7, >7 | more |
| Sleep quality | 1 to 5 | 5 |
| Mood | 1 to 5 | 5 |
| Soreness | 1 to 5 | 1 |
| Fatigue | 1 to 5 | 1 |
| Each symptom | 1 to 5, or Gone once ongoing | 1 |

Scores are colored from the worst end to the best: red, orange, yellow, blue,
green. Soreness 5 is red and Sleep quality 5 is green. The number stays on
every button.

## Once

1. Settings › Tracked items: rename, hide or archive any item.
2. Add symptom: one per thing you want to follow. Symptoms added here stay on
   Today across days.
3. Settings › Check-in timing: the day change time and how long one check-in
   stays open.

## Each check-in

| Task | Taps |
|---|---|
| One scale (sleep, mood, soreness, fatigue) | 1 each |
| A symptom at 1 | 1 |
| A symptom at 2 to 5 | 2 |
| Update an ongoing symptom | 1 |
| A symptom not on Today (+ Other, name, Enter) | 2 plus typing |
| Add a note | 2 plus typing |

- A symptom chip records 1 and opens the symptom's row of scores. Try any
  score; only × removes the symptom.
- Tapping the chosen scale score again clears it.
- Undo: in the toast after each tap.

## Copy today's state

**Copy today's state** under Today's check-ins copies plain text: the date,
the latest value of each item recorded today, today's symptoms by score and
any notes. Items not recorded today are left out.

```
2026-01-20
Sleep hours: 6-7 h
Sleep quality: 4/5 Good
Mood: 3/5 Okay
Soreness: 2/5 Mild
Fatigue: 5/5 Severe
Symptoms: Headache 3/5
Note: Slept 5 hours
```

## One sitting

Taps within 30 minutes of a check-in's start update it. The line above the
scales says which check-in is open and until when. After that, the next tap
starts a new check-in.

## Lasting symptoms

A symptom recorded at 1 or worse in the last 7 days keeps its row: Gone, 1 to
5, with the last score outlined. Tap today's score each day. Gone ends it. A
symptom added through + Other leaves Today once it is gone.

## Data version

Version 3 data. Data saved by earlier versions is refused; on load it moves to
the recovery copy (`checkin.v1.unreadable`) and Today starts empty.
