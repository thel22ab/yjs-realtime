### Issue 9: The "Lost Update" Gap (Check-then-Act)

**Problem**: A subtle but critical data loss window existed in the flushing logic.
1.  The system captures pending updates to save.
2.  It `await`s the database write (which takes 10-50ms).
3.  It clears the *entire* pending buffer.

If a user typed a character *during* step 2 (while the database write was in flight), that new update would be added to the buffer and then immediately wiped out in step 3.

**Solution**: We changed the buffer clearing logic to use **Snapshot Slicing**.
1.  Capture a snapshot of the buffer: `updatesToFlush = [...buffer]`.
2.  Perform the DB write.
3.  Remove *only* the count of items we flushed: `buffer = buffer.slice(updatesToFlush.length)`.
Any new updates arriving during the I/O remain safely in the buffer for the next cycle.

### Issue 10: The Shutdown Write Window

**Problem**: When the server received a `SIGINT` (Ctrl+C), it immediately started flushing data to the database but left the WebSocket server open. This created a "zombie" state where connected clients could still send updates to the server memory *while* the server was finalizing its state, causing those final milliseconds of data to be silently lost when the process exited.

**Solution**: We updated the shutdown sequence to **Stop Ingress First**.
1.  `wss.close()`: Stop accepting new WebSocket messages immediately.
2.  `server.close()`: Stop accepting new HTTP requests.
3.  `persistence.shutdown()`: Only then, flush the remaining data to disk.
