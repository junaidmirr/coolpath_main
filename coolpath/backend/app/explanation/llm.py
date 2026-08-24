import os

def generate_explanation(structured_facts: dict) -> str:
    """
    Generates tailored natural-language explanations based on the decision,
    thermal reduction, wait time, and chosen activity (walking, running, biking, driving).
    """
    decision = structured_facts.get('decision', 'GO')
    wait = structured_facts.get('wait_minutes', 0)
    reduction = structured_facts.get('thermal_reduction_percent', 0)
    activity = str(structured_facts.get('activity', 'walking')).lower()

    activity_names = {
        "walking": "walk",
        "running": "run",
        "biking": "ride",
        "driving": "drive"
    }
    act_verb = activity_names.get(activity, "trip")

    if activity == "running":
        if decision == "WAIT_AND_REROUTE":
            return (
                f"High exertion during peak heat dramatically increases cardiovascular stress and dehydration risk. "
                f"Waiting {wait} minutes and following the cooler alternate route reduces your thermal exposure by {reduction}%, "
                f"protecting your running performance while still finishing on schedule."
            )
        elif decision == "WAIT":
            return (
                f"Departing in {wait} minutes avoids peak ambient heat, lowering your running thermal strain by {reduction}% "
                f"and allowing for a safer, more sustainable workout pace."
            )
        elif decision == "REROUTE":
            return (
                f"The recommended running path diverts away from heat-retaining asphalt corridors into cooler shaded segments, "
                f"reducing your thermal load by {reduction}% without extending your workout duration."
            )
        elif decision == "HIGH HEAT — BEST AVAILABLE PLAN":
            return (
                f"Caution: High ambient temperatures across all runnable routes. "
                f"This is the best available route to meet your deadline, but consider pacing down and carrying hydration."
            )
        else:
            return (
                f"Current conditions on the direct route are optimal for running. "
                f"Thermal exposure is within acceptable exertion limits — depart now."
            )

    elif activity == "biking":
        if decision == "WAIT_AND_REROUTE":
            return (
                f"Waiting {wait} minutes and taking the recommended cycling corridor reduces your thermal exposure by {reduction}%. "
                f"This combines natural wind convection with cooler microclimates while meeting your arrival deadline."
            )
        elif decision == "WAIT":
            return (
                f"By delaying your ride by {wait} minutes, ground-level heat drops substantially, "
                f"reducing heat stress by {reduction}%."
            )
        elif decision == "REROUTE":
            return (
                f"The alternate bike route prioritizes cooler, lower-heat streets, "
                f"reducing total thermal exposure by {reduction}% while maintaining high cycling efficiency."
            )
        elif decision == "HIGH HEAT — BEST AVAILABLE PLAN":
            return (
                f"Notice: High temperatures detected along the cycling network. "
                f"This route provides the best thermal balance to achieve your deadline."
            )
        else:
            return (
                f"The fastest cycling route offers favorable thermal conditions and optimal airflow. No waiting or reroute required."
            )

    elif activity == "driving":
        if decision == "WAIT_AND_REROUTE":
            return (
                f"Waiting {wait} minutes and selecting the alternate roadway avoids severe heat corridor congestion, "
                f"reducing thermal impact on your vehicle and route by {reduction}%."
            )
        elif decision == "WAIT":
            return (
                f"Delaying departure by {wait} minutes allows surface temperatures to cool, "
                f"offering a {reduction}% reduction in ambient thermal exposure."
            )
        elif decision == "REROUTE":
            return (
                f"The alternate driving route bypasses intense thermal hotspots with comparable travel time, "
                f"achieving a {reduction}% thermal reduction."
            )
        elif decision == "HIGH HEAT — BEST AVAILABLE PLAN":
            return (
                f"Elevated temperatures on all drivable routes. This route delivers the shortest overall exposure."
            )
        else:
            return (
                f"The fastest driving route is clear and optimal. No rerouting needed."
            )

    else:  # default: walking
        if decision == "WAIT_AND_REROUTE":
            return (
                f"Leaving now puts you through a hotter pedestrian corridor. Waiting {wait} minutes and taking the alternate "
                f"route reduces estimated thermal exposure by {reduction}% while still arriving before your deadline."
            )
        elif decision == "WAIT":
            return (
                f"By delaying your walk by {wait} minutes, the current route cools down significantly, "
                f"reducing estimated thermal exposure by {reduction}% while still arriving on time."
            )
        elif decision == "REROUTE":
            return (
                f"The alternate path avoids high-heat zones present on the fastest route, "
                f"reducing your estimated thermal exposure by {reduction}% without violating your time constraints."
            )
        elif decision == "HIGH HEAT — BEST AVAILABLE PLAN":
            return (
                f"Warning: No significantly cooler walking alternative exists without violating your deadline. "
                f"This is the best available plan under current conditions."
            )
        else:
            return (
                f"The fastest route is currently optimal for both thermal exposure and travel time. "
                f"No reroute or waiting is required."
            )
