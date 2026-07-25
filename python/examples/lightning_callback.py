"""One-line experiment tracking for PyTorch Lightning.

    pip install 'thesis-tracker[lightning]'
    python examples/lightning_callback.py

Add the callback to your Trainer — it opens a run, logs whatever you
`self.log(...)`, and closes it on fit end.
"""

from thesis_tracker.integrations.lightning import ThesisTrackerCallback

# import lightning as L
# trainer = L.Trainer(
#     max_epochs=20,
#     callbacks=[ThesisTrackerCallback(name="beta-vae", project="My Thesis")],
# )
# trainer.fit(model, datamodule)

if __name__ == "__main__":
    print(ThesisTrackerCallback.__doc__ or "Add ThesisTrackerCallback to your Trainer.")
