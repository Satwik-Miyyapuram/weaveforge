package org.weaveforge.ink

/** Where a launch intent sends the page; shared by [PlanWidgetProvider] and [InkPlugin]. */
object InkRoute {
    /** The page origin on Android: Tauri's `app` scheme with `useHttpsScheme`. */
    const val APP_ORIGIN = "https://app.localhost"

    /** Same extra as the old app's MainActivity, so widgets already pinned keep working. */
    const val EXTRA_ROUTE = "org.weaveforge.ink.ROUTE"

    /** The [EXTRA_ROUTE] value that opens the plan page. */
    const val ROUTE_PLAN = "plan"

    /** The page a route extra asks for, or null for none or an unknown one. */
    fun url(route: String?): String? = when (route) {
        ROUTE_PLAN -> "$APP_ORIGIN/plan"
        else -> null
    }
}
