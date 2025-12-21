# Company Quadrant & Trajectory Visualization

## Purpose

This document describes a **simple, intuitive visual system** for explaining where a company is in its lifecycle and where it is heading, designed for **non‑expert users** (e.g., a college freshman with no finance background).

The goal is to answer, in **5–10 seconds**, the most important questions a new user has when they see a ticker for the first time:

* *Is this company real and stable, or still risky?*
* *Is it mostly done growing, or could it become much bigger?*
* *Is it improving or getting worse over time?*

This system intentionally avoids financial jargon and replaces it with **human‑readable concepts** expressed visually.

---

## Core Visual: The Quadrant

The primary visualization is a **2‑axis quadrant chart**. Position conveys meaning more strongly than numbers or text.

### Axis Definitions (Locked)

These axis labels must remain stable over time.

### Y‑Axis: "How Proven Is This Company?"

* Bottom: **Not Proven Yet**
* Top: **Very Proven**

This axis captures whether the company:

* Has a working business
* Produces consistent revenue or output
* Has survived multiple cycles
* Is reliable rather than experimental

This applies across sectors:

* Tech: product adoption, profitability, durability
* Mining: production history, reserve confidence
* Energy: sustained output and cash generation
* REITs: stabilized occupancy and cash flow

### X‑Axis: "How Much Bigger Can It Get?"

* Left: **Not Much Room to Grow**
* Right: **A Lot of Room to Grow**

This axis captures remaining upside:

* Market saturation vs expansion
* New products, projects, or markets
* Scalability of the business model

It is **not** short‑term growth rate; it is long‑term headroom.

---

## Quadrant Interpretation (Plain Language)

The quadrant names are intentionally descriptive, not financial.

* **Top‑Right (Very Proven + Can Grow A Lot)**
  *Strong Growers* — companies that work today and still have meaningful expansion ahead.

* **Top‑Left (Very Proven + Limited Growth)**
  *Reliable Businesses* — established, stable companies where returns come from durability, not rapid growth.

* **Bottom‑Right (Not Proven Yet + Can Grow A Lot)**
  *Early Bets* — risky companies that could become much larger if things go right.

* **Bottom‑Left (Not Proven Yet + Limited Growth)**
  *Struggling / Fading* — companies that are neither stable nor promising.

Users should be able to infer these meanings **without reading any explanation**.

---

## Circle Encoding

### Position (Primary Signal)

* Determined solely by the two axis scores
* Communicates lifecycle stage implicitly

### Size: Market Capitalization

* Circle size represents **company size**
* Implemented using **bucketed or log‑scaled market cap** (e.g., micro, small, mid, large, mega)
* Purpose: give immediate context for scale and impact

### Fill: Profitability State

* Hollow: not profitable
* Half‑filled: near breakeven / improving
* Solid: profitable

These are the **only default encodings**. Additional signals should be optional.

---

## Trajectory (Time Dimension)

Static position shows *where the company is*.
**Trajectory shows where it is going.**

### Concept

Trajectory is based on the company’s **movement across the quadrant over recent quarters** (typically 3–5).

Each quarter produces a point:

* X = Growth Headroom score
* Y = Proven score

These points are connected to form a path.

### Visual Rules

* Oldest points: smaller, lighter
* Newest point: larger, darker (the main bubble)
* A subtle arrow indicates direction of movement

### Interpretation (Intuitive)

* Arrow up/right: becoming more proven and more promising
* Arrow up/left: stabilizing but maturing
* Arrow down/right: growth potential rising but execution weakening
* Arrow down/left: deterioration

No numbers or dates are required for first‑time users.

---

## Lifecycle Mapping (Internal Only)

While the UI never explicitly shows lifecycle phases, the quadrant naturally maps to them:

* Early lifecycle → bottom‑right
* Growth lifecycle → top‑right
* Mature lifecycle → top‑left
* Decline lifecycle → drifting bottom‑left

This mapping allows advanced logic (valuation, thesis selection, portfolio sizing) to be driven internally without exposing complexity to the user.

---

## Why This Works

* Uses **position, size, and motion**, which humans process faster than text
* Avoids financial jargon entirely
* Works across sectors without changing labels
* Teaches users intuitively through repetition
* Scales from a single stock to portfolio‑level views

The quadrant becomes a **mental map**, not just a chart.

---

## Future Extensions (Optional)

* Sector color coding
* Peer comparison (same quadrant, multiple dots)
* Portfolio overlays
* Animation through time
* Drill‑down explanations on hover

All extensions must preserve the simplicity of the default view.

---

## Guiding Principle

> **The user should understand the company before they understand the numbers.**

This visualization is the front door to deeper analysis, not a replacement for it.
