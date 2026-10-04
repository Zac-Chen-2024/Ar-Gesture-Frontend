**English** | [简体中文](README.zh-CN.md)

# Gesture Typing

Type by swiping: a phone (or a laptop touchpad) becomes a blank touchpad, and a
display shows the keyboard, the cursor, word candidates and the typed sentence.

**Live**: <https://gesturetyping.com/>

## How to use

1. Open **Display** on the computer — it shows a 4-digit **Session** code.
2. Open **Phone** on the phone and tap that code to pair.
3. Swipe words on the phone; the display shows the result.
   - Slide up into the **candidate bar** and lift on a word to pick it, or on ⌫
     to delete the last word.
   - Slide down to **Clear** (bottom-left) and lift to clear the text.

**Touchpad mode** (Device = Touchpad): the laptop touchpad replaces the phone.
Moving starts a word, a click ends it, and **Esc** exits.

**Spell an unknown word (OOV)**: on the phone, move the cursor onto its first
letter, hold still for **1 second** until the display says “Hold complete”, then
lift. The first letter enters a green, underlined draft. Each subsequent swipe
and lift appends its endpoint letter immediately, without spaces or another hold.
Slide up into the bar and lift on **⌫ Letter**, **✓ Commit word**, or **× Cancel**.
Commit appends the entire word to the sentence and returns to word input; Cancel
discards only the draft. To replace a wrongly decoded word, delete that word
before spelling. Center starts every letter at G; Continuous starts at the last
confirmed letter. The bottom Clear/Undo region is inactive during spelling.

This also works in **Collection**. Commit or cancel the draft before saving a
sentence; skipping preserves the draft in the collection event log. Both frontend
and backend must be updated. A cancelled touch does not confirm a letter.

**Unify** (Word start → Unify): the cursor stays where you leave it and only a
click acts — a tap on the phone, a click on the touchpad. Trace over a word's
letters and click **Space** (the key under V) to decode it; the word stays dashed
while the bar's candidates can still replace it. Click letters one by one to
spell a word, then Space to finish; the bar offers completions. ⌫ in the bar
deletes a letter while spelling, otherwise the last word. The keyboard state
machine is in the “Unify input mode · state machine” doc.

**Display style**: the small half-filled circle in the bottom-left corner
switches between two looks; the choice is saved per browser.

The version in the bottom-right corner identifies the build.
