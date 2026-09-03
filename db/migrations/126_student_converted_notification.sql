-- Añade el tipo 'student_converted' al enum notification_type.
-- Usado en post-conversion-flow.ts para avisar al profesor cuando su lead convierte.
ALTER TYPE notification_type ADD VALUE IF NOT EXISTS 'student_converted';
