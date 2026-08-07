"""One-line experiment tracking for PyTorch Lightning.

    pip install 'weaveforge[lightning]'
    python examples/lightning_callback.py

Add the callback to your Trainer — it opens a run, logs whatever you
`self.log(...)`, and closes it on fit end.
"""

from weaveforge.integrations.lightning import WeaveForgeCallback

# import lightning as L
# trainer = L.Trainer(
#     max_epochs=20,
#     callbacks=[WeaveForgeCallback(name="beta-vae", project="My Thesis")],
# )
# trainer.fit(model, datamodule)

if __name__ == "__main__":
    print(WeaveForgeCallback.__doc__ or "Add WeaveForgeCallback to your Trainer.")
