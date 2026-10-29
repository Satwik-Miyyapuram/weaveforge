package org.weaveforge.ink

/**
 * The build's host allow-list (`BuildConfig.ALLOWED_HOSTS`, see
 * `app/build.gradle.kts`) and the one rule for matching it. The shell's
 * navigation policy, the widget setup screen and [PlanWidgetModel] all use it,
 * so they cannot drift apart. Free of Android types, so it is a JVM test.
 */
object HostAllowList {
    /** The comma-separated build list, trimmed and lower-cased, blanks dropped. */
    fun parse(csv: String): Set<String> =
        csv.split(',').map { it.trim().lowercase() }.filter { it.isNotEmpty() }.toSet()

    /** Whether [host] is a listed host or a subdomain of one. */
    fun allows(host: String?, hosts: Collection<String>): Boolean {
        val h = host?.lowercase()?.takeIf { it.isNotEmpty() } ?: return false
        return hosts.any { h == it || h.endsWith(".$it") }
    }
}
