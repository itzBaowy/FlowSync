-- Preserve unique ordering while permitting atomic swaps/rebalancing in explicitly deferred transactions.
ALTER TABLE "Column" ADD CONSTRAINT "Column_boardId_position_key" UNIQUE USING INDEX "Column_boardId_position_key" DEFERRABLE INITIALLY IMMEDIATE;
ALTER TABLE "Task" ADD CONSTRAINT "Task_columnId_position_key" UNIQUE USING INDEX "Task_columnId_position_key" DEFERRABLE INITIALLY IMMEDIATE;
