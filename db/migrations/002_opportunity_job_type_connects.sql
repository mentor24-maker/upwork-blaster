-- Two more fields Dane can see on an Upwork job post (task 2.1, hand-off
-- §5B's card): whether it is fixed price or hourly, and how many Connects a
-- proposal costs. Both stay NULL when he leaves them blank: unknown.
ALTER TABLE opportunity ADD COLUMN job_type TEXT CHECK (job_type IN ('fixed', 'hourly'));
ALTER TABLE opportunity ADD COLUMN connects_cost INTEGER CHECK (connects_cost >= 0);
