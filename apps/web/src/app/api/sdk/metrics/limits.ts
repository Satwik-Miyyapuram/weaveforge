/**
 * What one metrics ingest request may ask the server to do.
 *
 * Ingest walks the batch series by series, and each series costs a database
 * round trip to find the stored tip. Both numbers below exist so that cost is
 * bounded by the limits rather than by the size of the body a caller sent.
 *
 * The Python SDK chunks its flushes to `MAX_POINTS_PER_REQUEST`
 * (`api_metric_repository.py`), so a long `log_history` still lands — it
 * arrives as several requests instead of one.
 */
export const MAX_POINTS_PER_REQUEST = 5000;

/**
 * Distinct `(experiment, metric)` curves in one request.
 *
 * A training run writes on the order of tens of metrics; a body naming
 * thousands of them is asking for a round trip per name, not recording a run.
 */
export const MAX_SERIES_PER_REQUEST = 200;
