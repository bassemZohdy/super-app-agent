/** Execute the same asserted browser journeys without presentation pauses/video. */
import { runJourneys } from './e2e/runner.ts';
await runJourneys({ video: false });
