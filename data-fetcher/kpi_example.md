# KPI Example Structure

## Overview

Each KPI object represents a custom metric extracted from quarterly investor relations documents. The structure separates the numeric value (with unit and multiplier) from metadata about the metric.

## Structure

- **`name`** (required): Canonical name of the KPI
- **`value`** (required): Object containing:
  - **`number`**: Numeric value
  - **`unit`**: Base unit (e.g., "dollar", "ounce", "count", "percentage")
  - **`multiplier`**: Scale factor ("billion", "million", or null)
- **`value_type`** (required): Type of value measurement:
  - `"quarterly"`: Single quarter metric
  - `"point_in_time"`: Snapshot at a specific point
  - `"ttm"`: Trailing twelve months
  - `"ytd"`: Year-to-date cumulative
  - `"change_yoy"`: Year-over-year change
  - `"change_mom"`: Month-over-month change
  - `"change_qoq"`: Quarter-over-quarter change
- **`summary`** (required): Clear definition of what the metric represents. Should not have specific references to the time. 
- **`source`** (required): Document or section where the KPI was found
- **`group`** (required): Category for grouping related KPIs. The main purpose of the group is to combine the KPIs for the different segments; don't try to artificially reduce number of groups. Group names rarely change.
- **`frequency`** (required): Number of quarters this KPI has been reported
- **`other_names`** (optional): Alternative names or variations for this KPI

## Matching KPIs Across Documents

KPI names can vary across documents due to different naming conventions, abbreviations, or terminology. When matching similar KPIs from different documents or quarters, use the following criteria:

### Matching Criteria

1. **`name`**: Can be similar but doesn't need to be exact (e.g., "iPhone Revenue" vs "iPhone Sales" vs "iPhone Segment Revenue")

2. **`value.unit`**: Must be the same (e.g., both "dollar" or both "ounce"). This is critical - different units indicate different metrics.

3. **`value.multiplier`**: Must be the same (e.g., both "billion" or both "million" or both null). This ensures the metrics are on the same scale.

4. **`value_type`**: Must be the same (e.g., both "quarterly" or both "change_yoy"). Different value types represent fundamentally different measurements.

5. **`summary`**: Should be similar in meaning. The summary field describes what the metric represents, so semantically similar summaries indicate the same KPI.

6. **`other_names`**: Can be considered to derive the meaning. If a KPI's `other_names` array contains names that match another KPI's canonical name, they likely refer to the same metric.

### Example

The following KPIs should be considered the same metric:
- **KPI 1**: `name: "iPhone Revenue"`, `value.unit: "dollar"`, `value.multiplier: "billion"`, `value_type: "quarterly"`, `other_names: ["iPhone Sales"]`
- **KPI 2**: `name: "iPhone Sales"`, `value.unit: "dollar"`, `value.multiplier: "billion"`, `value_type: "quarterly"`

They match because:
- Names are similar (one is in the other's `other_names`)
- Units are identical ("dollar")
- Multipliers are identical ("billion")
- Value types are identical ("quarterly")
- Summaries would be semantically similar

## Example JSON

```json
[
  {
    "name": "iPhone Revenue",
    "value": {
      "number": 71.628,
      "unit": "dollar",
      "multiplier": "billion"
    },
    "value_type": "quarterly",
    "summary": "Top-line revenue from iPhone hardware sales including all iPhone models before deducting costs and expenses",
    "source": "Q1 2022 Earnings Release",
    "group": "Business Segments",
    "frequency": 1,
    "other_names": ["iPhone Sales", "iPhone Segment Revenue"]
  },
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
    "group": "Business Segments",
    "frequency": 1
  },
  {
    "name": "Google Cloud Revenue",
    "value": {
      "number": 9.19,
      "unit": "dollar",
      "multiplier": "billion"
    },
    "value_type": "quarterly",
    "summary": "Top-line revenue from Google Cloud infrastructure and platform services before deducting cost of revenue and operating expenses",
    "source": "Q1 2024 Earnings Release",
    "group": "Business Segments",
    "frequency": 1
  },
  {
    "name": "Monthly Active Users",
    "value": {
      "number": 2.5,
      "unit": "count",
      "multiplier": null
    },
    "value_type": "point_in_time",
    "summary": "Total number of monthly active users across all platforms",
    "source": "Q1 2024 Earnings Release",
    "group": "User Metrics",
    "frequency": 8
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
    "group": "Operational Metrics",
    "frequency": 12
  },
  {
    "name": "Americas Revenue",
    "value": {
      "number": 50.6,
      "unit": "dollar",
      "multiplier": "billion"
    },
    "value_type": "quarterly",
    "summary": "Revenue from Americas region including North and South America",
    "source": "Q1 2024 Earnings Release",
    "group": "Geographic Breakdown",
    "frequency": 16
  },
  {
    "name": "Paid Subscribers",
    "value": {
      "number": 250,
      "unit": "count",
      "multiplier": "million"
    },
    "value_type": "quarterly",
    "summary": "Total number of active paid subscribers across all service offerings",
    "source": "Q1 2024 Earnings Release",
    "group": "User Metrics",
    "frequency": 10
  },
  {
    "name": "Silver Production",
    "value": {
      "number": 8.5,
      "unit": "ounce",
      "multiplier": "million"
    },
    "value_type": "quarterly",
    "summary": "Total silver production in ounces for the quarter",
    "source": "Q1 2024 Production Report",
    "group": "Operational Metrics",
    "frequency": 12
  },
  {
    "name": "Mac Revenue",
    "value": {
      "number": 10.85,
      "unit": "dollar",
      "multiplier": "billion"
    },
    "value_type": "quarterly",
    "summary": "Top-line revenue from Mac hardware sales including all Mac models before deducting costs and expenses",
    "source": "Q1 2022 Earnings Release",
    "group": "Business Segments",
    "frequency": 1
  },
  {
    "name": "Year-to-Date Revenue",
    "value": {
      "number": 150.5,
      "unit": "dollar",
      "multiplier": "billion"
    },
    "value_type": "ytd",
    "summary": "Cumulative revenue from the beginning of the fiscal year through Q1 2024",
    "source": "Q1 2024 Earnings Release",
    "group": "Business Segments",
    "frequency": 4
  },
  {
    "name": "Trailing Twelve Months Revenue",
    "value": {
      "number": 450.2,
      "unit": "dollar",
      "multiplier": "billion"
    },
    "value_type": "ttm",
    "summary": "Total revenue for the trailing twelve months ending Q1 2024",
    "source": "Q1 2024 Earnings Release",
    "group": "Business Segments",
    "frequency": 8
  },
  {
    "name": "Revenue Growth Rate",
    "value": {
      "number": 15.5,
      "unit": "percentage",
      "multiplier": null
    },
    "value_type": "change_yoy",
    "summary": "Year-over-year revenue growth rate expressed as a percentage",
    "source": "Q1 2024 Earnings Release",
    "group": "Business Segments",
    "frequency": 8
  },
  {
    "name": "Month-over-Month Growth",
    "value": {
      "number": 2.3,
      "unit": "percentage",
      "multiplier": null
    },
    "value_type": "change_mom",
    "summary": "Month-over-month growth rate expressed as a percentage",
    "source": "Q1 2024 Earnings Release",
    "group": "Operational Metrics",
    "frequency": 4
  },
  {
    "name": "Quarter-over-Quarter Growth",
    "value": {
      "number": 5.2,
      "unit": "percentage",
      "multiplier": null
    },
    "value_type": "change_qoq",
    "summary": "Quarter-over-quarter growth rate expressed as a percentage",
    "source": "Q1 2024 Earnings Release",
    "group": "Business Segments",
    "frequency": 6
  },
  {
    "name": "Employee Headcount",
    "value": {
      "number": 187,
      "unit": "count",
      "multiplier": null
    },
    "value_type": "point_in_time",
    "summary": "Total number of employees as of quarter end",
    "source": "Q1 2024 10-Q Filing",
    "group": "RSU/Compensation",
    "frequency": 4
  }
]
```
