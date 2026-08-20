package com.zandaulion.omaha.engine

/**
 * Tie cases for `Number.prototype.toFixed`.
 *
 * Each of these is exactly representable in binary, so rounding it to one
 * decimal is a true tie rather than a floating-point artefact. ECMAScript is
 * explicit that a tie rounds to the larger value, so every one of these has a
 * single correct answer, and any engine that disagrees is deviating from spec
 * rather than expressing a preference.
 */
val TO_FIXED_TIE_CASES = listOf(
    4.25 to "4.3",
    0.125 to "0.13",
    2.5 to "3",
    1.005 to "1.00",   // not a tie in binary; 1.005 is just below the midpoint
    8.75 to "8.8",
    3.375 to "3.38"
)

/** JS that renders each case, for evaluating in whichever engine is under test. */
val TO_FIXED_PROBE_JS = """
    const cases = [[4.25,1],[0.125,2],[2.5,0],[1.005,2],[8.75,1],[3.375,2]];
    __out(cases.map(([v,d]) => v + '.toFixed(' + d + ')=' + v.toFixed(d)).join('  '));
""".trimIndent()
