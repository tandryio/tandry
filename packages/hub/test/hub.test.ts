import { runHubSuite, startLocalHub } from "../testing/suite";

// A small bucket without refill makes the rate-limit scenario exact.
runHubSuite(() => startLocalHub({ vars: { SEND_BUCKET_SIZE: "30", SEND_REFILL_PER_MINUTE: "0" } }));
