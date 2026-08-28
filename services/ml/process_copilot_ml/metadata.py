from __future__ import annotations


def variable_dictionary() -> list[dict[str, str]]:
    measurements = [
        ("A Feed (stream 1)", "kscmh"),
        ("D Feed (stream 2)", "kg/h"),
        ("E Feed (stream 3)", "kg/h"),
        ("A and C Feed (stream 4)", "kscmh"),
        ("Recycle Flow (stream 8)", "kscmh"),
        ("Reactor Feed Rate (stream 6)", "kscmh"),
        ("Reactor Pressure", "kPa gauge"),
        ("Reactor Level", "%"),
        ("Reactor Temperature", "degC"),
        ("Purge Rate (stream 9)", "kscmh"),
        ("Product Separator Temperature", "degC"),
        ("Product Separator Level", "%"),
        ("Product Separator Pressure", "kPa gauge"),
        ("Product Separator Underflow (stream 10)", "m3/h"),
        ("Stripper Level", "%"),
        ("Stripper Pressure", "kPa gauge"),
        ("Stripper Underflow (stream 11)", "m3/h"),
        ("Stripper Temperature", "degC"),
        ("Stripper Steam Flow", "kg/h"),
        ("Compressor Work", "kW"),
        ("Reactor Cooling Water Outlet Temperature", "degC"),
        ("Separator Cooling Water Outlet Temperature", "degC"),
    ]
    components = [
        *(f"Reactor Feed Analysis Component {name}" for name in "ABCDEF"),
        *(f"Purge Gas Analysis Component {name}" for name in "ABCDEFGH"),
        *(f"Product Analysis Component {name}" for name in "DEFGH"),
    ]
    variables = [
        {"variableId": f"XMEAS({index})", "variableName": name, "unit": unit}
        for index, (name, unit) in enumerate(measurements, start=1)
    ]
    variables.extend(
        {
            "variableId": f"XMEAS({index})",
            "variableName": name,
            "unit": "mol%",
        }
        for index, name in enumerate(components, start=23)
    )
    manipulated = [
        "D Feed Flow (stream 2)",
        "E Feed Flow (stream 3)",
        "A Feed Flow (stream 1)",
        "A and C Feed Flow (stream 4)",
        "Compressor Recycle Valve",
        "Purge Valve (stream 9)",
        "Separator Pot Liquid Flow (stream 10)",
        "Stripper Liquid Product Flow (stream 11)",
        "Stripper Steam Valve",
        "Reactor Cooling Water Flow",
        "Condenser Cooling Water Flow",
    ]
    variables.extend(
        {"variableId": f"XMV({index})", "variableName": name, "unit": "%"}
        for index, name in enumerate(manipulated, start=1)
    )
    return variables
