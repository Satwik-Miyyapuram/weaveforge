package org.weaveforge.ink

import android.app.Activity
import android.appwidget.AppWidgetManager
import android.content.Intent
import android.os.Bundle
import android.view.View
import android.widget.Button
import android.widget.EditText
import android.widget.TextView

/**
 * Setup for the deadlines widget: the user pastes the calendar link from
 * Settings, Calendar. Opened by the launcher when the widget is placed, and
 * again from the widget itself when it has no link or its link was turned off.
 */
class PlanWidgetConfigActivity : Activity() {
    private var widgetId = AppWidgetManager.INVALID_APPWIDGET_ID

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        widgetId = intent?.getIntExtra(AppWidgetManager.EXTRA_APPWIDGET_ID, AppWidgetManager.INVALID_APPWIDGET_ID)
            ?: AppWidgetManager.INVALID_APPWIDGET_ID
        // Backing out of setup cancels placing the widget.
        setResult(RESULT_CANCELED, resultIntent())
        setContentView(R.layout.activity_widget_setup)

        val input = findViewById<EditText>(R.id.setup_url)
        val error = findViewById<TextView>(R.id.setup_error)
        findViewById<Button>(R.id.setup_cancel).setOnClickListener { finish() }
        findViewById<Button>(R.id.setup_save).setOnClickListener {
            val url = PlanWidgetModel.widgetUrl(
                input.text.toString(),
                BuildConfig.ALLOWED_HOSTS.split(',').map { it.trim().lowercase() }.filter { it.isNotEmpty() },
                allowCleartext = BuildConfig.APP_URL.startsWith("http:"),
            )
            if (url == null) {
                error.visibility = View.VISIBLE
                return@setOnClickListener
            }
            PlanWidgetProvider.saveFeedUrl(this, url)
            PlanWidgetProvider.updateAll(this)
            setResult(RESULT_OK, resultIntent())
            finish()
        }
    }

    private fun resultIntent() = Intent().putExtra(AppWidgetManager.EXTRA_APPWIDGET_ID, widgetId)
}
