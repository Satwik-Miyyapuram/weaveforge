"""One-line experiment tracking for Keras.

    pip install 'weaveforge[keras]'
    python examples/keras_callback.py

Pass the callback to model.fit — it logs each epoch's metrics into a run.
"""

from weaveforge.integrations.keras import WeaveForgeCallback

# model.fit(
#     x, y, epochs=20,
#     callbacks=[WeaveForgeCallback(name="cnn", project="My Thesis")],
# )

if __name__ == "__main__":
    print(WeaveForgeCallback.__doc__ or "Add WeaveForgeCallback to model.fit.")
