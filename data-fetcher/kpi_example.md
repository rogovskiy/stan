### Overview

This document defines the JSON structure for Key Performance Indicators (KPIs) extracted from quarterly investor relations documents. This structure is used for storing, matching, and processing KPIs across the system.

Each KPI object represents a custom metric with its numeric value, metadata, and semantic interpretation.

### Complete Field Reference

#### Top-Level Fields

#### `name` (required, string)
Canonical name of the KPI as it appears in the source document. Examples:
- `"iPhone Revenue"`
- `"Gold Production"`
- `"Monthly Active Users"`

#### `value` (required, object)
Object containing the numeric value with its unit and scale:

- **`number`** (required, number): The numeric value
- **`unit`** (required, string): Base unit (e.g., `"dollar"`, `"ounce"`, `"count"`, `"percentage"`)
- **`multiplier`** (optional, string | null): Scale factor. Examples:
  - `"billion"`
  - `"million"`
  - `null` (for values without a multiplier)

**Example:**
```json
{
  "number": 71.628,
  "unit": "dollar",
  "multiplier": "billion"
}
```

#### `value_type` (required, string)
Type of value measurement. Examples:
- `"quarterly"`: Single quarter metric
- `"point_in_time"`: Snapshot at a specific point in time
- `"ttm"`: Trailing twelve months (rolling 12-month period)
- `"ytd"`: Year-to-date cumulative (from start of fiscal year)
- `"change_yoy"`: Year-over-year change (percentage or absolute)
- `"change_mom"`: Month-over-month change (percentage or absolute)
- `"change_qoq"`: Quarter-over-quarter change (percentage or absolute)

#### `summary` (required, string)
Clear, time-agnostic definition of what the metric represents. Should describe the metric conceptually without specific time references.

**Good examples:**
- `"Top-line revenue from iPhone hardware sales including all iPhone models before deducting costs and expenses"`
- `"Total gold production in ounces"`

**Bad examples:**
- `"iPhone revenue for Q1 2024"` (includes time reference)
- `"Gold production this quarter"` (includes time reference)

#### `source` (required, string)
Document or section where the KPI was found. Examples:
- `"Q1 2022 Earnings Release"`
- `"Q1 2024 Production Report"`
- `"Q1 2024 10-Q Filing"`

#### `semantic_interpretation` (required, object)
Object containing the structured semantic meaning of the KPI.

This field defines the identity of the metric and must remain stable across quarters.

#### Required Fields

#### `measure_kind` (required, string)
Conceptual type of measurement. Examples for illustration purpose only:
- `"revenue"`: Income from sales or services
- `"operating_income"`: Income from operations
- `"production_volume"`: Amount of product produced
- `"sales_volume"`: Volume of sales (units, quantities)
- `"price"`: Unit price or average price
- `"cost"`: Cost of goods or services
- `"margin"`: Profit margin or percentage (including growth rates)
- `"count"`: Number of employees, users, or subscribers
- `"capex"`: Capital expenditure

#### `subject` (required, string)
The economic actor whose performance or financial outcome is being measured.

This must be the core entity name only (e.g., `"Company"`, `"Segovia"`, `"Americas"`).

**Key Principle: Subjects are economic actors (companies, segments, geographies, operations, mines, subsidiaries), not the products or commodities they produce or sell. Products, commodities, and physical goods should be placed in qualifiers, not used as subjects.**

#### `subject_axis` (required, string)
The dimension that defines what type of economic actor the subject represents.

Examples for illustration purpose only:
- `"company"`: Company-wide metrics (no specific subject segmentation)
- `"segment"`: Business segment metrics (e.g., Services, Cloud, business divisions)
- `"geography"`: Geographic region metrics (e.g., Americas, EMEA, Asia-Pacific)
- `"operation"`: Operation-specific metrics (e.g., specific mines, facilities)
- `"subsidiary"`: Subsidiary or subsidiary-level metrics

#### `unit_family` (required, string)
Normalized unit category. Examples:
- `"money"`: Currency-based units (dollar, euro, etc.)
- `"count"`: Count-based units (users, employees, units sold)
- `"mass"`: Mass-based units (ounces, tons, kilograms)
- `"percentage"`: Percentage values
- `"money_per_unit"`: Ratio of money to units (e.g., price per ounce, revenue per user)

#### `value_semantics` (required, string)
Describes how the value behaves over time. Examples:
- `"flow"`: Accumulated over a period (e.g., quarterly revenue, production volume)
- `"stock"`: Point-in-time snapshot (e.g., headcount at quarter end, cash balance)
- `"rate"`: Ratio or per-unit metric (e.g., price per ounce, revenue per user)
- `"change"`: Delta or growth metric (e.g., YoY growth, QoQ change)

#### Optional Fields

#### `qualifiers` (optional, object)
Object containing non-identity attributes that further constrain or describe the KPI observation.

**Common qualifier keys for illsutration purpose:**
- `"product"`: Product or commodity sold or produced (e.g., `"gold"`, `"silver"`, `"iPhone"`)
- `"product_form"`: Physical or commercial form (e.g., `"dore"`, `"concentrate"`, `"refined"`)
- `"origin"`: Source of production or activity (e.g., `"Segovia Operations"`)
- `"ownership"`: Ownership or attribution type (e.g., `"owned"`, `"partner"`, `"joint_venture"`)
- `"accounting_basis"`: Reporting basis (e.g., `"GAAP"`, `"non_GAAP"`, `"adjusted"`)
- `"capex_type"`: Capital expenditure classification (e.g., `"growth"`, `"sustaining"`)
- `"exclusions"`: Explicit exclusions if stated (e.g., `"byproducts"`)
- `"status"`: Status or state (e.g., `"active"`, `"inactive"`, `"pending"`)
- `"period"`: Time period for measurement (e.g., `"monthly"`, `"daily"`, `"annual"`)

### Complete Example JSON

```json
[
  {
    "name": "Services Revenue",
    "value": {
      "number": 19.516,
      "unit": "dollar",
      "multiplier": "billion"
    },
    "value_type": "quarterly",
    "summary": "Top-line revenue from services segment including App Store, Apple Music, iCloud, and advertising before deducting costs and expenses",
    "source": "Q1 2022 Earnings Release",
    "semantic_interpretation": {
      "measure_kind": "revenue",
      "subject": "Services",
      "subject_axis": "segment",
      "unit_family": "money",
      "value_semantics": "flow"
    }
  },
  {
    "name": "Gold Production",
    "value": {
      "number": 1.2,
      "unit": "ounce",
      "multiplier": "million"
    },
    "value_type": "quarterly",
    "summary": "Total gold production in ounces for the quarter",
    "source": "Q1 2024 Production Report",
    "semantic_interpretation": {
      "measure_kind": "production_volume",
      "subject": "Company",
      "subject_axis": "company",
      "unit_family": "mass",
      "value_semantics": "flow",
      "qualifiers": [
        {"key": "product", "value": "gold"}
      ]
    }
  }
]
```