"""Add your own sync source — the extension point.

Implement the MetricSource protocol (an `id`, `available()`, `read()`),
register it, and drive it through the exact same `track(sync=...)` call the
built-in sources use. No SDK code changes needed (Open/Closed).

    python examples/custom_source.py        # reads a local CSV of step,loss
"""

import csv
import io

from thesis_tracker import track
from thesis_tracker.features.experiments.domain.metric_point import MetricSeries
from thesis_tracker.sync import default_registry

CSV = "step,loss,acc\n0,1.0,0.4\n1,0.6,0.7\n2,0.3,0.9\n"


class CsvSource:
    id = "csv"

    def available(self) -> bool:
        return True

    def read(self, ref):
        reader = csv.DictReader(io.StringIO(ref))
        series: dict[str, MetricSeries] = {}
        for row in reader:
            step = int(row.pop("step"))
            for metric, value in row.items():
                series.setdefault(metric, MetricSeries(metric)).add(step, float(value))
        return list(series.values())


def main():
    default_registry.register(CsvSource(), replace=True)
    with track("custom-source demo", sync={"csv": CSV}) as run:
        print("imported CSV curves into experiment", run.id)


if __name__ == "__main__":
    main()
