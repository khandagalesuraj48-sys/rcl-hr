-- RCL ERP – HR module, STEP 8: a shift's own time at which a forgotten OUT is closed by itself.
-- Asked 12-11-2026: "sign out karaych visrun gela tr systeam 11.50 pm la auto sign out krel ani tyachi attendence mark hoil
-- absent" – and for a night shift the time is another one, so the time is the SHIFT's (decided: "Shift प्रमाणे वेळ").
--
-- Run ONCE in the rcl-hr Supabase → SQL Editor (only there – never in another module's database). After step 5.
--
-- What it does: ONE new column in hr_shifts – auto_out (a time, empty for every shift of today).
--   empty      = as before: a day with IN and no OUT reads "IN without OUT" until it is set right
--   a time     = at that time the day is closed by itself and counts as ABSENT (at or before the shift's start: the next day –
--                a night shift). The employee can still ask to set the day right (regularization).
-- Nothing is deleted or changed: no row gets a value; no punch is written or touched by this – the day is only READ that way.
-- It can be run again (it changes nothing the second time).
--
-- Going back: alter table public.hr_shifts drop column auto_out;   (the shifts read as before)

alter table public.hr_shifts add column if not exists auto_out time;

-- the API reads the new column at once
notify pgrst, 'reload schema';
