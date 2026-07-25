"""One-line experiment tracking for Keras.

    pip install 'thesis-tracker[keras]'
    python examples/keras_callback.py

Pass the callback to model.fit — it logs each epoch's metrics into a run.
"""

from thesis_tracker.integrations.keras import ThesisTrackerCallback

# model.fit(
#     x, y, epochs=20,
#     callbacks=[ThesisTrackerCallback(name="cnn", project="My Thesis")],
# )

if __name__ == "__main__":
    print(ThesisTrackerCallback.__doc__ or "Add ThesisTrackerCallback to model.fit.")
