'use client';

import { useState } from 'react';
import QuarterlyAnalysisView from './QuarterlyAnalysisView';
import { QuarterlyAnalysis } from '../types/api';

/**
 * Demo component showing how to use QuarterlyAnalysisView
 * This demonstrates the UI with sample data
 */
export default function QuarterlyAnalysisDemo() {
  // Sample data matching the structure from generate_quarterly_analysis.py
  const [sampleAnalyses] = useState<QuarterlyAnalysis[]>([
    {
      ticker: 'AAPL',
      quarter_key: '2025Q1',
      summary: `In Q1 2025, Apple Inc. demonstrated robust financial performance, achieving a total net sales of $124.3 billion, marking a 4.7% increase year-over-year. The company's net income rose to $36.3 billion, reflecting strong operational efficiency and a solid gross margin of 46.9%. Key growth drivers included a notable increase in services revenue, which grew by 14.5%, and a steady performance in product sales despite a slight decline in iPhone revenue.

• Total net sales increased by 4.7% year-over-year to $124.3 billion
• Net income rose to $36.3 billion, reflecting strong operational efficiency
• Gross margin of 46.9% demonstrates solid profitability
• Services revenue grew by 14.5%, continuing strong momentum
• Product sales remained steady despite slight iPhone revenue decline`,
      growth_theses: [
        {
          title: 'Strong Revenue Growth in Services',
          summary: 'Apple\'s services segment continues to drive significant revenue growth, providing more stable and predictable income streams.',
          detailed_explanation: 'The Services segment, which includes App Store, iCloud, Apple Music, and other subscription services, grew by 14.5% year-over-year. This diversification reduces Apple\'s dependence on hardware sales cycles and provides recurring revenue with higher margins than product sales.',
          supporting_evidence: [
            'Services revenue grew by 14.5% year-over-year',
            'Services gross margin is significantly higher than hardware margins',
            'Active installed base of devices continues to grow, expanding the addressable market for services'
          ],
          strength: 'high' as const,
          expected_eps_growth: 6.5,
          eps_growth_drivers: [
            {
              factor: 'Services Revenue Growth',
              contribution_percent: 4.2,
              description: '14.5% revenue growth in high-margin Services segment',
              thesis_points: [
                'Growing installed base of devices expands addressable market for services',
                'Increasing subscription penetration across App Store, iCloud, and Apple Music',
                'New service offerings (Apple TV+, Fitness+) driving incremental revenue',
                'Higher-margin services revenue mix improving overall profitability'
              ],
              achievability_evidence: [
                {
                  metric_name: 'Services Revenue YoY Growth',
                  current_value: 14.5,
                  historical_trend: [11.2, 12.8, 14.5],
                  supporting_fact: 'Services revenue grew 14.5% YoY, well above the 4.2% EPS contribution target'
                },
                {
                  metric_name: 'Active Installed Base',
                  current_value: '2.2B devices',
                  supporting_fact: 'Growing installed base expands addressable market for services'
                }
              ]
            },
            {
              factor: 'Services Margin Expansion',
              contribution_percent: 2.3,
              description: 'Improved mix and scale driving margin improvements',
              thesis_points: [
                'Scale effects reducing per-unit costs as Services revenue grows',
                'Shift toward higher-margin subscription revenue vs one-time purchases',
                'Improved operational efficiency in content delivery and infrastructure',
                'Pricing power from ecosystem lock-in allows margin expansion'
              ],
              achievability_evidence: [
                {
                  metric_name: 'Services Gross Margin',
                  current_value: '72.5%',
                  historical_trend: [70.1, 71.3, 72.5],
                  supporting_fact: 'Services margins expanded 200 bps over past 3 quarters, supporting 2.3% EPS contribution'
                },
                {
                  metric_name: 'Subscription Revenue Mix',
                  current_value: '65%',
                  supporting_fact: 'Higher-margin subscription revenue increasing as % of total Services'
                }
              ]
            }
          ]
        },
        {
          title: 'Operational Efficiency and Profitability',
          summary: 'Apple\'s operational efficiency is reflected in its strong margins and income growth.',
          detailed_explanation: 'The company achieved a gross margin of 46.9% and net income of $36.3 billion, demonstrating strong operational efficiency. This profitability allows Apple to invest in innovation while returning capital to shareholders.',
          supporting_evidence: [
            'Gross margin of 46.9% demonstrates solid profitability',
            'Net income rose to $36.3 billion',
            'Strong operational efficiency across product lines'
          ],
          strength: 'high' as const,
          expected_eps_growth: 2.8,
          eps_growth_drivers: [
            {
              factor: 'Gross Margin Expansion',
              contribution_percent: 1.8,
              description: 'Improved product mix and cost efficiencies',
              thesis_points: [
                'Premium product mix (iPhone Pro models) commanding higher margins',
                'Supply chain optimization reducing manufacturing costs',
                'Component cost reductions from scale and supplier negotiations',
                'Services revenue growth improving overall margin mix'
              ],
              achievability_evidence: [
                {
                  metric_name: 'Gross Margin',
                  current_value: 46.9,
                  historical_trend: [44.2, 45.5, 46.9],
                  supporting_fact: 'Gross margin improved 270 bps YoY, driven by premium product mix'
                }
              ]
            },
            {
              factor: 'Operating Leverage',
              contribution_percent: 1.0,
              description: 'Fixed cost leverage on revenue growth',
              achievability_evidence: [
                {
                  metric_name: 'Revenue Growth',
                  current_value: 4.7,
                  supporting_fact: '4.7% revenue growth with controlled OpEx creates operating leverage'
                }
              ]
            }
          ]
        },
        {
          title: 'Resilience in Product Sales',
          summary: 'Despite challenges, Apple maintains strong product sales performance.',
          detailed_explanation: 'While iPhone revenue saw a slight decline, overall product sales remained steady. The company\'s diverse product portfolio, including Mac, iPad, and wearables, helps mitigate the impact of individual product line fluctuations.',
          supporting_evidence: [
            'Total net sales increased by 4.7% year-over-year to $124.3 billion',
            'Product sales remained steady despite slight iPhone revenue decline',
            'Diverse product portfolio provides resilience'
          ],
          strength: 'medium' as const,
          expected_eps_growth: 0.7,
          eps_growth_drivers: [
            {
              factor: 'Product Sales Volume',
              contribution_percent: 0.5,
              description: 'Steady product sales despite market headwinds'
            },
            {
              factor: 'Premium Product Mix',
              contribution_percent: 0.2,
              description: 'Higher ASP from premium product mix'
            }
          ]
        },
        {
          title: 'Market Position and Brand Strength',
          summary: 'Apple maintains its strong market position and brand strength, supporting premium pricing.',
          detailed_explanation: 'The company\'s ability to maintain premium pricing and strong margins reflects its brand strength and customer loyalty. This market position provides a competitive moat and pricing power.',
          supporting_evidence: [
            'Strong brand recognition and customer loyalty',
            'Premium pricing power maintained across product lines',
            'Market leadership in key segments'
          ],
          strength: 'medium' as const
        },
        {
          title: 'Regulatory and Litigation Risks',
          summary: 'Ongoing litigation and regulatory scrutiny pose potential headwinds to financial performance.',
          detailed_explanation: 'Apple faces multiple ongoing legal challenges including antitrust investigations, patent disputes, and regulatory actions in key markets. While the company has strong legal resources, adverse outcomes could impact margins and business operations.',
          supporting_evidence: [
            'Multiple antitrust investigations in EU and US',
            'Ongoing patent litigation with competitors',
            'Regulatory changes affecting App Store business model'
          ],
          strength: 'medium' as const,
          expected_eps_growth: -1.2,
          eps_growth_drivers: [
            {
              factor: 'Litigation Risk',
              contribution_percent: -1.2,
              description: 'Potential financial impact from ongoing legal proceedings',
              thesis_points: [
                'EU Digital Markets Act compliance costs and potential fines',
                'Antitrust investigations could force App Store fee reductions',
                'Patent disputes may require licensing payments or product changes',
                'Regulatory settlements could result in significant one-time charges'
              ],
              achievability_evidence: [
                {
                  metric_name: 'Legal Reserves',
                  current_value: '$2.5B',
                  supporting_fact: 'Company has set aside $2.5B for potential litigation settlements'
                },
                {
                  metric_name: 'Active Cases',
                  current_value: '15+',
                  supporting_fact: 'Multiple ongoing legal proceedings across key markets'
                }
              ]
            }
          ]
        }
      ],
      created_at: '2025-01-15T10:30:00Z',
      num_documents: 3,
      historical_eps: {
        two_quarters_ago: 1.26, // Q3 2024
        one_quarter_ago: 1.40,  // Q4 2024
        current: 1.53            // Q1 2025
      },
      kpi_metrics: [
        {
          name: 'iPhone Sales in China',
          unit: '%',
          values: [12.5, 10.0, 8.5, 7.2, 6.0, 5.5, 4.8, 4.2],
          trend: 'up' as const,
          description: 'YoY growth in China market'
        },
        {
          name: 'Efficiency Ratio',
          unit: '%',
          values: [46.9, 45.2, 44.8, 44.1, 43.5, 43.0, 42.5, 42.0],
          trend: 'up' as const,
          description: 'Gross margin percentage'
        },
        {
          name: 'Services Revenue',
          unit: '%',
          values: [14.5, 16.0, 8.0, 5.0, 4.2, 3.8, 3.5, 3.2],
          trend: 'up' as const,
          description: 'YoY Services revenue growth'
        }
      ],
      highlights: [
        {
          text: 'Services revenue',
          impact: '+14.5%',
          trend: 'up' as const
        },
        {
          text: 'Gross margin expansion',
          impact: '+270 bps',
          trend: 'up' as const
        },
        {
          text: 'Net income',
          impact: '$36.3B',
          trend: 'up' as const
        }
      ]
    },
    {
      ticker: 'AAPL',
      quarter_key: '2024Q4',
      summary: `Apple closed fiscal 2024 with solid fourth quarter results, capping off a year of innovation and growth. The company's ecosystem approach continues to drive customer loyalty and revenue growth across all product categories.

• Total revenue of $89.5 billion, up 1% year-over-year
• iPhone revenue of $43.8 billion, driven by iPhone 15 launch
• Services revenue of $22.3 billion, up 16% year-over-year
• Strong performance in wearables, home, and accessories segment
• Record quarterly revenue in several geographic segments`,
      growth_theses: [
        {
          title: 'Ecosystem Lock-in Effect',
          summary: 'Apple\'s integrated ecosystem creates strong customer retention and increases lifetime value.',
          detailed_explanation: 'The seamless integration between iPhone, Mac, iPad, Apple Watch, and services creates a powerful ecosystem that makes it difficult for customers to switch to competitors. This lock-in effect drives repeat purchases and higher customer lifetime value.',
          supporting_evidence: [
            'Over 2 billion active devices in the installed base',
            'Services revenue growth outpacing hardware revenue growth',
            'Customer retention rates remain exceptionally high'
          ],
          strength: 'high' as const,
          expected_eps_growth: 3.2,
          eps_growth_drivers: [
            {
              factor: 'Customer Retention',
              contribution_percent: 2.0,
              description: 'Higher customer lifetime value from ecosystem lock-in'
            },
            {
              factor: 'Cross-Selling',
              contribution_percent: 1.2,
              description: 'Increased product attach rates within ecosystem'
            }
          ]
        },
        {
          title: 'iPhone 15 Launch Success',
          summary: 'The iPhone 15 launch generated strong initial demand, particularly for Pro models.',
          detailed_explanation: 'The iPhone 15 series, featuring the new A17 Pro chip and titanium design, generated significant consumer interest. Early sales data suggests strong demand, especially for the premium Pro models.',
          supporting_evidence: [
            'iPhone revenue of $43.8 billion in the quarter',
            'Strong pre-order numbers for iPhone 15 Pro models',
            'Positive reviews from tech media and early adopters'
          ],
          strength: 'high' as const
        },
        {
          title: 'Wearables Growth',
          summary: 'Wearables, home, and accessories segment continues to show strong growth potential.',
          detailed_explanation: 'Apple Watch, AirPods, and other accessories have become significant revenue drivers. The segment benefits from the large installed base of iPhone users and continues to expand with new product introductions.',
          supporting_evidence: [
            'Wearables segment revenue grew year-over-year',
            'Apple Watch Series 9 launched with new features',
            'AirPods Pro with USB-C received positive reception'
          ],
          strength: 'medium' as const
        }
      ],
      created_at: '2024-10-15T10:30:00Z',
      num_documents: 4,
      historical_eps: {
        two_quarters_ago: 1.20, // Q2 2024
        one_quarter_ago: 1.26, // Q3 2024
        current: 1.40           // Q4 2024
      },
      kpi_metrics: [
        {
          name: 'iPhone Sales in China',
          unit: '%',
          values: [10.0, 8.5, 7.2, 6.0, 5.5, 4.8, 4.2, 3.8],
          trend: 'up' as const,
          description: 'YoY growth in China market'
        },
        {
          name: 'Efficiency Ratio',
          unit: '%',
          values: [45.2, 44.8, 44.1, 43.5, 43.0, 42.5, 42.0, 41.5],
          trend: 'up' as const,
          description: 'Gross margin percentage'
        },
        {
          name: 'Services Revenue',
          unit: '%',
          values: [16.0, 8.0, 5.0, 4.2, 3.8, 3.5, 3.2, 2.9],
          trend: 'up' as const,
          description: 'YoY Services revenue growth'
        }
      ],
      highlights: [
        {
          text: 'iPhone 15 sales',
          impact: '+10%',
          trend: 'up' as const
        },
        {
          text: 'China expansion',
          impact: '+10% for 3 quarters',
          trend: 'up' as const
        },
        {
          text: 'Services revenue',
          impact: '+16%',
          trend: 'up' as const
        }
      ]
    },
    {
      ticker: 'AAPL',
      quarter_key: '2024Q3',
      summary: `Apple reported third quarter results that exceeded expectations, driven by strong iPhone sales and continued momentum in Services. The company demonstrated resilience despite challenging market conditions.

• Revenue of $81.8 billion, down 1% year-over-year
• iPhone revenue of $39.7 billion, slightly down from previous year
• Services revenue of $21.2 billion, up 8% year-over-year
• Mac and iPad revenue declined due to product cycle timing
• Strong cash generation and capital returns to shareholders`,
      growth_theses: [
        {
          title: 'Services Resilience',
          summary: 'Services revenue growth demonstrates the durability of Apple\'s recurring revenue model.',
          detailed_explanation: 'Even as hardware sales fluctuate with product cycles, Services revenue continues to grow steadily. This provides stability and predictability to Apple\'s financial results.',
          supporting_evidence: [
            'Services revenue up 8% year-over-year',
            'Services gross margin remains above 70%',
            'Paid subscriptions across all services continue to grow'
          ],
          strength: 'high' as const
        },
        {
          title: 'Capital Allocation',
          summary: 'Apple\'s strong cash generation and shareholder returns demonstrate financial discipline.',
          detailed_explanation: 'The company continues to generate significant free cash flow and return capital to shareholders through dividends and share repurchases. This demonstrates confidence in the business and provides value to investors.',
          supporting_evidence: [
            'Returned over $25 billion to shareholders in the quarter',
            'Strong balance sheet with significant cash reserves',
            'Consistent dividend payments and share repurchase program'
          ],
          strength: 'medium' as const
        }
      ],
      created_at: '2024-07-15T10:30:00Z',
      num_documents: 3,
      kpi_metrics: [
        {
          name: 'iPhone Sales in China',
          unit: '%',
          values: [8.5, 7.2, 6.0, 5.5, 4.8, 4.2, 3.8, 3.5],
          trend: 'up' as const,
          description: 'YoY growth in China market'
        },
        {
          name: 'Efficiency Ratio',
          unit: '%',
          values: [44.8, 44.1, 43.5, 43.0, 42.5, 42.0, 41.5, 41.0],
          trend: 'up' as const,
          description: 'Gross margin percentage'
        },
        {
          name: 'Services Revenue',
          unit: '%',
          values: [8.0, 5.0, 4.2, 3.8, 3.5, 3.2, 2.9, 2.6],
          trend: 'up' as const,
          description: 'YoY Services revenue growth'
        }
      ],
      highlights: [
        {
          text: 'Services resilience',
          impact: '+8% YoY',
          trend: 'up' as const
        },
        {
          text: 'Capital returns',
          impact: '$25B to shareholders',
          trend: 'neutral' as const
        },
        {
          text: 'Mac revenue',
          impact: '-27%',
          trend: 'down' as const
        }
      ]
    },
    {
      ticker: 'AAPL',
      quarter_key: '2024Q2',
      summary: `Apple delivered solid second quarter results, with particular strength in iPhone sales and continued growth in emerging markets. The company navigated supply chain challenges effectively.

• Revenue of $94.8 billion, down 3% year-over-year
• iPhone revenue of $51.3 billion, driven by iPhone 14 Pro demand
• Services revenue of $20.9 billion, up 5% year-over-year
• Mac revenue declined due to difficult comparisons
• Strong performance in Greater China and emerging markets`,
      growth_theses: [
        {
          title: 'Supply Chain Optimization',
          summary: 'Apple has successfully diversified its supply chain, reducing risks and improving efficiency.',
          detailed_explanation: 'The company has made significant investments in diversifying its manufacturing base, particularly in India and Vietnam. This reduces dependence on any single region and improves supply chain resilience.',
          supporting_evidence: [
            'Increased production capacity in India',
            'Reduced supply chain disruptions compared to previous years',
            'Improved inventory management and logistics'
          ],
          strength: 'medium' as const
        },
        {
          title: 'Emerging Market Opportunity',
          summary: 'Strong growth in emerging markets, especially India, represents a significant long-term opportunity.',
          detailed_explanation: 'Apple is making strategic investments in emerging markets, particularly India, where the growing middle class represents a large untapped market. The company is expanding retail presence and local manufacturing.',
          supporting_evidence: [
            'India revenue reached new records',
            'Opening of new retail stores in India',
            'Local manufacturing partnerships established'
          ],
          strength: 'medium' as const
        }
      ],
      created_at: '2024-04-15T10:30:00Z',
      num_documents: 3,
      kpi_metrics: [
        {
          name: 'iPhone Sales in China',
          unit: '%',
          values: [7.2, 6.0, 5.5, 4.8, 4.2, 3.8, 3.5, 3.2],
          trend: 'up' as const,
          description: 'YoY growth in China market'
        },
        {
          name: 'Efficiency Ratio',
          unit: '%',
          values: [44.1, 43.5, 43.0, 42.5, 42.0, 41.5, 41.0, 40.5],
          trend: 'up' as const,
          description: 'Gross margin percentage'
        },
        {
          name: 'Services Revenue',
          unit: '%',
          values: [5.0, 4.2, 3.8, 3.5, 3.2, 2.9, 2.6, 2.4],
          trend: 'up' as const,
          description: 'YoY Services revenue growth'
        }
      ],
      highlights: [
        {
          text: 'iPhone 14 Pro demand',
          impact: 'Strong',
          trend: 'up' as const
        },
        {
          text: 'Supply chain optimization',
          impact: 'India expansion',
          trend: 'up' as const
        },
        {
          text: 'Emerging markets',
          impact: 'Record India revenue',
          trend: 'up' as const
        }
      ]
    }
  ]);

  return (
    <div className="min-h-screen bg-gray-50 font-sans antialiased">
      <div className="w-full max-w-none px-6 py-6">
        <QuarterlyAnalysisView analyses={sampleAnalyses} ticker="AAPL" />
      </div>
    </div>
  );
}

