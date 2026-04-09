-- Rename default label for built-in BOOKED outcome (admins can still override in Settings).
UPDATE "CallResultOption"
SET label = 'Book'
WHERE code = 'BOOKED' AND label = 'Booked';
