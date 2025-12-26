'use client';

import { useState, useMemo, useRef, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import {
  Line,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  ComposedChart,
  LineChart,
  Bar,
  BarChart,
  CartesianGrid
} from 'recharts';

interface Driver {
  id: string;
  description: string;
  confidence: number; // 0-100 percentage
  createdAt: string;
}

interface InvestmentThesis {
  id: string;
  title: string;
  description: string;
  expectedReturn: number; // percentage
  timeFrame: string;
  drivers?: Driver[];
  createdAt: string;
  updatedAt: string;
}

interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: string;
}

interface InvestmentThesisBuilderProps {
  ticker: string;
  companyName?: string | null;
  initialThesis?: InvestmentThesis;
  onSave?: (thesis: InvestmentThesis) => void;
  onBack?: () => void;
}

export default function InvestmentThesisBuilder({ 
  ticker, 
  companyName,
  initialThesis,
  onSave,
  onBack
}: InvestmentThesisBuilderProps) {
  const router = useRouter();
  const chatEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  
  // Mock data for demonstration
  const defaultThesis: InvestmentThesis = initialThesis || {
    id: 'thesis-1',
    title: 'iPhone 20 Product Launch Success',
    description: 'I want to buy Apple because I think their iPhone 20 will be an amazing product and everybody will upgrade within a year. The new AI features, improved battery life, and revolutionary design will drive unprecedented upgrade cycles.',
    expectedReturn: 25.5,
    timeFrame: '1-2 years',
    drivers: [
      {
        id: 'driver-1',
        description: 'Margin improves as Services revenue mix increases',
        confidence: 70, // Confident
        createdAt: new Date().toISOString()
      },
      {
        id: 'driver-2',
        description: 'Services continue to grow at current pace (15%+ YoY)',
        confidence: 70, // Confident
        createdAt: new Date().toISOString()
      },
      {
        id: 'driver-3',
        description: 'Multiples will expand from 25 to around 30',
        confidence: 50, // Moderate
        createdAt: new Date().toISOString()
      }
    ],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };

  const [thesis, setThesis] = useState<InvestmentThesis>(defaultThesis);
  const [selectedTimeFrame, setSelectedTimeFrame] = useState(thesis.timeFrame);
  const [currentPrice, setCurrentPrice] = useState<number | null>(null);
  const timeFrameOptions = ['1-2 years', '2-3 years', '3-5 years', '5-7 years', '7-10 years'];
  
  // Confidence levels for drivers (discrete ticks)
  const confidenceLevels = [
    { value: 10, label: 'Very low', shortLabel: 'Very low' },
    { value: 30, label: 'Low', shortLabel: 'Low' },
    { value: 50, label: 'Moderate', shortLabel: 'Moderate' },
    { value: 70, label: 'Confident', shortLabel: 'Confident' },
    { value: 90, label: 'High confidence', shortLabel: 'High' }
  ];
  
  // Helper to snap confidence to nearest level
  const snapToConfidenceLevel = (value: number): number => {
    return confidenceLevels.reduce((prev, curr) => 
      Math.abs(curr.value - value) < Math.abs(prev.value - value) ? curr : prev
    ).value;
  };
  
  // Calculate impact on valuation based on confidence
  const calculateImpactOnValuation = (confidence: number): 'High' | 'Medium' | 'Low' => {
    if (confidence >= 70) return 'High';
    if (confidence >= 50) return 'Medium';
    return 'Low';
  };
  
  // Get reality check summary (one sentence)
  const getRealityCheckSummary = (confidence: number): string => {
    const typicalOutcome = 50; // Typical historical average
    if (confidence > typicalOutcome + 10) {
      return 'Your assumption is more optimistic than historical averages, where similar drivers typically achieve around 50% success rates.';
    }
    if (confidence < typicalOutcome - 10) {
      return 'Your assumption is more conservative than historical patterns, which typically show around 50% confidence levels.';
    }
    return 'Your assumption aligns with historical observations, where similar drivers typically show around 50% confidence levels.';
  };
  
  // Get full reality check explanation (for chat)
  const getRealityCheckFullExplanation = (driver: Driver): string => {
    const typicalOutcome = 50;
    const confidence = driver.confidence;
    if (confidence > typicalOutcome + 10) {
      return `Historical data shows that similar drivers to "${driver.description}" have typically achieved moderate success rates around 50%. Your assumption of ${confidence}% confidence is more optimistic, suggesting stronger conviction in this factor. While higher confidence can indicate deeper analysis, it's important to consider that most comparable scenarios have fallen short of such high expectations.`;
    }
    if (confidence < typicalOutcome - 10) {
      return `Historical patterns indicate that similar drivers to "${driver.description}" have generally performed around 50% confidence levels. Your assumption of ${confidence}% confidence is more conservative, which may reflect a more cautious approach or recognition of additional risks. This lower confidence could help set more realistic expectations and reduce potential disappointment.`;
    }
    return `Your assumption of ${confidence}% confidence for "${driver.description}" aligns closely with historical observations, where similar drivers have typically shown around 50% confidence levels. This suggests your assessment is grounded in realistic expectations based on past performance patterns.`;
  };
  
  // Handle explain button click (prepared for chat integration)
  const handleExplainRealityCheck = (driver: Driver) => {
    const explanation = getRealityCheckFullExplanation(driver);
    // TODO: Send explanation to chat window
    // This would typically add a message to the chat with the explanation
    console.log('Would send to chat:', explanation);
  };
  
  // Calculate position for assumption marker (0-100% of bar width)
  const getAssumptionPosition = (confidence: number): number => {
    // Map confidence (10-90) to position (0-100)
    return ((confidence - 10) / 80) * 100;
  };
  
  // Calculate typical outcomes range position
  const getTypicalOutcomesRange = () => {
    // Typical outcomes span from ~40% to ~60% (centered around 50%)
    const start = ((40 - 10) / 80) * 100;
    const end = ((60 - 10) / 80) * 100;
    return { start, width: end - start };
  };
  
  // Fetch current price when ticker changes
  useEffect(() => {
    const fetchCurrentPrice = async () => {
      if (!ticker) return;
      
      try {
        // For now, use a mock price. In production, fetch from API
        // const response = await fetch(`/api/stock-price?ticker=${ticker}`);
        // const data = await response.json();
        // setCurrentPrice(data.price);
        setCurrentPrice(12); // Mock price for now
      } catch (err) {
        console.error('Error fetching current price:', err);
        setCurrentPrice(12); // Fallback to mock
      }
    };
    
    fetchCurrentPrice();
  }, [ticker]);
  
  // Calculate return insights
  const returnInsights = useMemo(() => {
    if (!currentPrice) return null;
    
    const targetPrice = currentPrice * (1 + thesis.expectedReturn / 100);
    
    // Calculate CAGR based on time frame
    const timeFrameYears = (() => {
      if (thesis.timeFrame.includes('1-2')) return 1.5;
      if (thesis.timeFrame.includes('2-3')) return 2.5;
      if (thesis.timeFrame.includes('3-5')) return 4;
      if (thesis.timeFrame.includes('5-7')) return 6;
      if (thesis.timeFrame.includes('7-10')) return 8.5;
      return 1.5;
    })();
    
    // CAGR = (Target Price / Current Price)^(1/Years) - 1
    const cagr = (Math.pow(targetPrice / currentPrice, 1 / timeFrameYears) - 1) * 100;
    
    // For market value, we'll use a mock market cap (in billions)
    // In production, this would be fetched from the API
    const mockMarketCap = 100; // $100B market cap
    const targetMarketCap = mockMarketCap * (1 + thesis.expectedReturn / 100);
    
    // Calculate thesis confidence metrics
    const drivers = thesis.drivers || [];
    let overallConfidence = 'Low';
    let limitingFactor = 'N/A';
    let strongestSupport = 'N/A';
    
    if (drivers.length > 0) {
      const avgConfidence = drivers.reduce((sum, d) => sum + d.confidence, 0) / drivers.length;
      
      // Determine overall confidence level
      if (avgConfidence >= 75) {
        overallConfidence = 'High';
      } else if (avgConfidence >= 50) {
        overallConfidence = 'Medium';
      } else if (avgConfidence >= 25) {
        overallConfidence = 'Low–Medium';
      } else {
        overallConfidence = 'Low';
      }
      
      // Find limiting factor (lowest confidence driver)
      const lowestConfidenceDriver = drivers.reduce((min, d) => 
        d.confidence < min.confidence ? d : min
      );
      limitingFactor = lowestConfidenceDriver.description;
      
      // Find strongest support (highest confidence driver)
      const highestConfidenceDriver = drivers.reduce((max, d) => 
        d.confidence > max.confidence ? d : max
      );
      strongestSupport = highestConfidenceDriver.description;
    }
    
    // Calculate recommended position sizing
    // Based on confidence and expected return
    // Higher confidence + higher return = larger position
    const avgConfidence = drivers.length > 0
      ? drivers.reduce((sum, d) => sum + d.confidence, 0) / drivers.length
      : 0;
    
    // Position sizing formula: confidence * return / 100, capped at reasonable levels
    // This gives a percentage of portfolio allocation
    const basePosition = (avgConfidence / 100) * (thesis.expectedReturn / 100) * 100;
    const recommendedPositionPercent = Math.min(Math.max(basePosition, 0), 20); // Between 0% and 20%
    
    // Determine position category
    let positionCategory: string;
    let positionRange: string;
    let isGated = false;
    
    if (recommendedPositionPercent < 0.5) {
      positionCategory = 'Watchlist / No position';
      positionRange = '';
    } else if (recommendedPositionPercent < 2) {
      positionCategory = 'Small position';
      positionRange = '0.5–2%';
    } else if (recommendedPositionPercent < 5) {
      positionCategory = 'Starter';
      positionRange = '2–5%';
    } else if (recommendedPositionPercent < 10) {
      positionCategory = 'Core';
      positionRange = '5–10%';
    } else {
      positionCategory = 'Concentrated';
      positionRange = '10%+';
      isGated = true;
    }
    
    return {
      currentPrice,
      targetPrice,
      cagr,
      currentMarketCap: mockMarketCap,
      targetMarketCap,
      overallConfidence,
      limitingFactor,
      strongestSupport,
      recommendedPositionPercent,
      positionCategory,
      positionRange,
      isGated
    };
  }, [currentPrice, thesis.expectedReturn, thesis.timeFrame, thesis.drivers]);
  
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([
    {
      id: 'msg-1',
      role: 'assistant',
      content: `I've analyzed your investment thesis about ${ticker}. You're expecting a ${thesis.expectedReturn}% return over ${thesis.timeFrame} based on the iPhone 20 launch success. Let's break down the key drivers and discuss how we can track progress.`,
      timestamp: new Date().toISOString()
    },
    {
      id: 'msg-2',
      role: 'user',
      content: 'I think iPhone 20 will drive strong revenue growth, and Services will continue expanding margins.',
      timestamp: new Date(Date.now() - 3600000).toISOString()
    },
    {
      id: 'msg-3',
      role: 'assistant',
      content: `Great! I've set up your drivers based on that. The chart on the left shows the expected revenue growth trajectory based on your drivers and their confidence levels. You can adjust the confidence for each driver to see how it impacts the projections. What would you like to adjust or discuss next?`,
      timestamp: new Date(Date.now() - 1800000).toISOString()
    }
  ]);
  const [inputValue, setInputValue] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [editingDriver, setEditingDriver] = useState<Driver | null>(null);
  const [showAddDriver, setShowAddDriver] = useState(false);
  const [newDriverText, setNewDriverText] = useState('');

  // Scroll to bottom when new messages arrive
  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [chatMessages]);

  // Prepare value chart data showing stock value growth
  const valueChartData = useMemo(() => {
    const baseValue = 150; // Starting stock price/value
    const baselineGrowthRate = 0.02; // 2% per quarter baseline growth
    const thesisMultiplier = 1.15; // Thesis adds 15% premium to growth rate
    
    // Generate historical data points (8 quarters)
    const historicalData = [];
    const now = new Date();
    
    for (let i = 8; i >= 1; i--) {
      const quarterDate = new Date(now);
      quarterDate.setMonth(quarterDate.getMonth() - (i * 3));
      const quarter = `Q${Math.floor((quarterDate.getMonth() + 3) / 3)} ${quarterDate.getFullYear()}`;
      
      // Historical value with some variation
      const historicalValue = baseValue * Math.pow(1 + baselineGrowthRate, 8 - i) * (0.95 + Math.random() * 0.1);
      
      historicalData.push({
        quarter,
        baselineValue: historicalValue,
        thesisValue: historicalValue, // Same in historical period
        date: quarterDate
      });
    }
    
    // Generate projected data based on drivers
    const projectedData = [];
    let currentBaselineValue = historicalData[historicalData.length - 1].baselineValue;
    let currentThesisValue = currentBaselineValue;
    
    // Calculate average driver confidence to determine growth premium
    const avgConfidence = thesis.drivers && thesis.drivers.length > 0
      ? thesis.drivers.reduce((sum, d) => sum + d.confidence, 0) / thesis.drivers.length
      : 50;
    
    // Generate 8 quarters of projected data
    for (let i = 1; i <= 8; i++) {
      const quarterDate = new Date(now);
      quarterDate.setMonth(quarterDate.getMonth() + (i * 3));
      const quarter = `Q${Math.floor((quarterDate.getMonth() + 3) / 3)} ${quarterDate.getFullYear()}`;
      
      // Baseline grows at 2% per quarter
      currentBaselineValue = currentBaselineValue * (1 + baselineGrowthRate);
      
      // Thesis value grows faster - apply growth premium based on driver confidence
      // Higher confidence = higher value premium
      const growthPremium = 1 + (avgConfidence / 100) * thesisMultiplier;
      currentThesisValue = currentThesisValue * (1 + baselineGrowthRate) * growthPremium;
      
      projectedData.push({
        quarter,
        baselineValue: currentBaselineValue,
        thesisValue: currentThesisValue,
        date: quarterDate
      });
    }
    
    return [...historicalData, ...projectedData];
  }, [thesis.drivers]);

  // Historical iPhone revenue data (mock data - in billions)
  const historicaliPhoneData = useMemo(() => {
    // Generate 8 quarters of historical data (2 years back)
    const now = new Date();
    const historicalQuarters = [];
    
    for (let i = 8; i >= 1; i--) {
      const quarterDate = new Date(now);
      quarterDate.setMonth(quarterDate.getMonth() - (i * 3));
      const quarter = `Q${Math.floor((quarterDate.getMonth() + 3) / 3)} ${quarterDate.getFullYear()}`;
      
      // Simulate realistic iPhone revenue with some variation
      // Starting around $45B and gradually increasing to ~$50B
      const baseValue = 45 + (8 - i) * 0.6 + (Math.random() - 0.5) * 2;
      
      historicalQuarters.push({
        quarter,
        revenue: Math.round(baseValue * 10) / 10,
        isHistorical: true
      });
    }
    
    return historicalQuarters;
  }, []);

  // Prepare iPhone sales bar chart data with hypothetical increases (stacked: organic vs thesis-based)
  const iPhoneSalesData = useMemo(() => {
    // Base iPhone revenue (hypothetical starting point - in billions)
    const baseRevenue = historicaliPhoneData.length > 0 
      ? historicaliPhoneData[historicaliPhoneData.length - 1].revenue 
      : 50;
    const organicGrowthRate = 2.5; // 2.5% organic growth per quarter (baseline)
    
    // Generate projected quarters based on time frame
    const projectedQuarters = 8; // 2 years of quarters
    const projectedData = [];
    
    for (let i = 1; i <= projectedQuarters; i++) {
      const quarterDate = new Date();
      quarterDate.setMonth(quarterDate.getMonth() + (i * 3));
      const quarter = `Q${Math.floor((quarterDate.getMonth() + 3) / 3)} ${quarterDate.getFullYear()}`;
      
      // Calculate cumulative revenue with organic growth
      let organicRevenue = baseRevenue;
      for (let j = 0; j < i; j++) {
        organicRevenue = organicRevenue * (1 + organicGrowthRate / 100);
      }
      
      // Apply thesis-based growth (simplified - using average driver confidence)
      const avgConfidence = thesis.drivers && thesis.drivers.length > 0
        ? thesis.drivers.reduce((sum, d) => sum + d.confidence, 0) / thesis.drivers.length
        : 50;
      const growthMultiplier = 1 + (avgConfidence / 100) * 0.1; // Scale confidence to growth
      const totalRevenue = organicRevenue * growthMultiplier;
      const thesisBasedRevenue = totalRevenue - organicRevenue;
      
      projectedData.push({
        quarter,
        baseline: Math.round(organicRevenue * 10) / 10,
        thesisBased: Math.max(0, Math.round(thesisBasedRevenue * 10) / 10),
        total: Math.round(totalRevenue * 10) / 10,
        isHistorical: false
      });
    }
    
    // Combine historical and projected data
    const historicalFormatted = historicaliPhoneData.map(h => ({
      quarter: h.quarter,
      baseline: h.revenue,
      thesisBased: 0,
      total: h.revenue,
      isHistorical: true
    }));
    
    return [...historicalFormatted, ...projectedData];
  }, [thesis.drivers, historicaliPhoneData]);

  const handleSendMessage = async () => {
    if (!inputValue.trim() || isLoading) return;

    const userMessage: ChatMessage = {
      id: `msg-${Date.now()}`,
      role: 'user',
      content: inputValue,
      timestamp: new Date().toISOString()
    };

    setChatMessages(prev => [...prev, userMessage]);
    setInputValue('');
    setIsLoading(true);

    // Simulate AI response (in production, this would call an API)
    setTimeout(() => {
      const assistantMessage: ChatMessage = {
        id: `msg-${Date.now() + 1}`,
        role: 'assistant',
        content: generateMockResponse(inputValue),
        timestamp: new Date().toISOString()
      };
      setChatMessages(prev => [...prev, assistantMessage]);
      setIsLoading(false);
    }, 1000);
  };

  const generateMockResponse = (userInput: string): string => {
    const lowerInput = userInput.toLowerCase();
    
    if (lowerInput.includes('driver') || lowerInput.includes('add') || lowerInput.includes('create')) {
      return `I can help you add a new driver. What factor do you think will drive your expected return? For example, "Margin expansion from Services growth" or "Multiple expansion as market recognizes growth."`;
    }
    
    if (lowerInput.includes('return') || lowerInput.includes('expect') || lowerInput.includes('target')) {
      return `Your expected return of ${thesis.expectedReturn}% over ${thesis.timeFrame} is ambitious but achievable if your drivers play out. Based on the revenue growth trajectory, here's how we can validate this:\n\n• If iPhone revenue grows as projected, and assuming margins hold steady, we could see EPS growth of 8-12% annually\n• Combined with potential multiple expansion if the market recognizes the growth, your target return is within reach\n\nWould you like me to create a more detailed financial model to validate this?`;
    }
    
    if (lowerInput.includes('update') || lowerInput.includes('change') || lowerInput.includes('modify')) {
      return `I can help you update any part of your thesis. You can modify:\n\n• Expected return and time frame\n• Driver descriptions and confidence levels\n• Add or remove drivers\n\nWhat specifically would you like to change?`;
    }
    
    return `I understand. Let me help you refine your investment thesis. Based on your drivers, we're tracking ${thesis.drivers?.length || 0} key factors. The visualization on the left shows the expected progression. Is there anything specific you'd like to discuss or adjust?`;
  };

  const handleKeyPress = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSendMessage();
    }
  };

  const handleAddDriver = () => {
    if (!newDriverText.trim()) return;
    
    const newDriver: Driver = {
      id: `driver-${Date.now()}`,
      description: newDriverText.trim(),
      confidence: 50, // Default to Moderate
      createdAt: new Date().toISOString()
    };
    
    setThesis({
      ...thesis,
      drivers: [...(thesis.drivers || []), newDriver],
      updatedAt: new Date().toISOString()
    });
    
    setNewDriverText('');
    setShowAddDriver(false);
  };

  const handleEditDriver = (driver: Driver) => {
    setEditingDriver(driver);
    setNewDriverText(driver.description);
    setShowAddDriver(true);
  };

  const handleSaveDriver = () => {
    if (!editingDriver || !newDriverText.trim()) return;
    
    setThesis({
      ...thesis,
      drivers: (thesis.drivers || []).map(driver =>
        driver.id === editingDriver.id
          ? { ...driver, description: newDriverText.trim() }
          : driver
      ),
      updatedAt: new Date().toISOString()
    });
    
    setEditingDriver(null);
    setNewDriverText('');
    setShowAddDriver(false);
  };

  const handleDeleteDriver = (driverId: string) => {
    if (confirm('Are you sure you want to delete this driver?')) {
      setThesis({
        ...thesis,
        drivers: (thesis.drivers || []).filter(driver => driver.id !== driverId),
        updatedAt: new Date().toISOString()
      });
    }
  };

  const handleUpdateDriverConfidence = (driverId: string, confidence: number) => {
    setThesis({
      ...thesis,
      drivers: (thesis.drivers || []).map(driver =>
        driver.id === driverId
          ? { ...driver, confidence }
          : driver
      ),
      updatedAt: new Date().toISOString()
    });
  };


  return (
    <div className="flex h-[calc(100vh-200px)] bg-gray-50 rounded-xl overflow-hidden border border-gray-200 shadow-lg">
      {/* Left Side - Plot/Visualization */}
      <div className="flex-1 bg-white border-r border-gray-200 overflow-y-auto flex flex-col">
        <div className="p-6">
          {/* Header with Back and Save buttons */}
          <div className="mb-4 flex items-center justify-between pb-4 border-b border-gray-200">
            <button
              onClick={() => {
                if (onBack) {
                  onBack();
                } else {
                  router.push(`/${ticker}`);
                }
              }}
              className="flex items-center gap-2 px-3 py-2 text-sm text-gray-600 hover:text-gray-900 hover:bg-gray-100 rounded-md transition-colors"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
              </svg>
              Back to Analysis
            </button>
            <button
              onClick={() => {
                const updatedThesis = { ...thesis, updatedAt: new Date().toISOString() };
                if (onSave) {
                  onSave(updatedThesis);
                } else {
                  // Default save behavior - save to localStorage
                  localStorage.setItem(`thesis-${ticker}`, JSON.stringify(updatedThesis));
                  alert('Thesis saved successfully!');
                }
              }}
              className="px-4 py-2 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-md transition-colors"
            >
              Save Thesis
            </button>
          </div>

          {/* Thesis Text at Top */}
          <div className="mb-6">
            <div className="flex items-start justify-between mb-4">
              <div className="flex-1">
                <input
                  type="text"
                  value={thesis.title}
                  onChange={(e) => setThesis({ ...thesis, title: e.target.value, updatedAt: new Date().toISOString() })}
                  className="text-2xl font-bold text-gray-900 mb-3 w-full bg-transparent border-none focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-inset rounded px-2 -mx-2"
                  placeholder="Enter thesis title..."
                />
                <textarea
                  value={thesis.description}
                  onChange={(e) => setThesis({ ...thesis, description: e.target.value, updatedAt: new Date().toISOString() })}
                  className="text-base text-gray-700 leading-relaxed whitespace-pre-wrap w-full bg-transparent border-none focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-inset rounded px-2 -mx-2 resize-none"
                  placeholder="Enter thesis description..."
                  rows={4}
                />
              </div>
              <div className="ml-6 flex-shrink-0">
                <div className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">
                  Time Frame
                </div>
                <div className="flex items-center gap-2 bg-gray-100 rounded-lg p-1">
                  {timeFrameOptions.map((option) => (
                    <button
                      key={option}
                      onClick={() => {
                        setSelectedTimeFrame(option);
                        setThesis({ ...thesis, timeFrame: option });
                      }}
                      className={`px-3 py-1.5 text-sm font-medium rounded-md transition-all duration-200 ${
                        selectedTimeFrame === option
                          ? 'bg-white text-gray-900 shadow-sm border border-gray-200'
                          : 'text-gray-600 hover:text-gray-900 hover:bg-gray-50'
                      }`}
                    >
                      {option}
                    </button>
                  ))}
                </div>
                <div className="mt-3">
                  <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">
                    Expected Return
                  </label>
                  <div className="flex items-center gap-3">
                    <input
                      type="range"
                      min="0"
                      max="100"
                      step="0.5"
                      value={thesis.expectedReturn}
                      onChange={(e) => {
                        const newValue = parseFloat(e.target.value);
                        setThesis({ ...thesis, expectedReturn: newValue });
                      }}
                      className="flex-1 h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer slider"
                    />
                    <div className="w-14 text-right">
                      <strong className="text-gray-900 text-sm font-semibold">
                        {thesis.expectedReturn.toFixed(1)}%
                      </strong>
                    </div>
                  </div>
                  
                  {/* Return Insights */}
                  {returnInsights && (
                    <div className="mt-4 p-3 bg-gray-50 rounded-lg border border-gray-200">
                      <div className="space-y-2.5 text-xs font-mono">
                        <div className="flex justify-between items-center">
                          <span className="text-gray-600">Current price:</span>
                          <span className="font-semibold text-gray-900">${returnInsights.currentPrice.toFixed(2)}</span>
                        </div>
                        <div className="flex justify-between items-center">
                          <span className="text-gray-600">Target price:</span>
                          <span className="font-semibold text-gray-900">${returnInsights.targetPrice.toFixed(2)}</span>
                        </div>
                        <div className="h-2"></div>
                        <div className="flex justify-between items-center">
                          <span className="text-gray-600">Implied CAGR:</span>
                          <span className="font-semibold text-gray-900">~{returnInsights.cagr.toFixed(1)}%</span>
                        </div>
                        <div className="flex justify-between items-center">
                          <span className="text-gray-600">Implied market value:</span>
                          <span className="font-semibold text-gray-900">
                            ${returnInsights.currentMarketCap.toFixed(0)}B → ${returnInsights.targetMarketCap.toFixed(0)}B
                          </span>
                        </div>
                        <div className="h-2"></div>
                        <p className="text-gray-500 italic text-[11px] leading-relaxed font-sans">
                          This return requires meaningful change in the business.
                        </p>
                      </div>
                    </div>
                  )}
                  
                  {/* Thesis Confidence */}
                  {returnInsights && (
                    <div className="mt-4 p-3 bg-gray-50 rounded-lg border border-gray-200">
                      <div className="mb-2">
                        <h5 className="text-xs font-semibold text-gray-700 uppercase tracking-wide">Thesis Confidence</h5>
                      </div>
                      <div className="space-y-2.5 text-xs font-mono">
                        <div className="flex justify-between items-center">
                          <span className="text-gray-600">Overall confidence:</span>
                          <span className="font-semibold text-gray-900">{returnInsights.overallConfidence}</span>
                        </div>
                        <div className="flex justify-between items-start gap-2">
                          <span className="text-gray-600 flex-shrink-0">Limiting factor:</span>
                          <span className="font-semibold text-gray-900 text-right flex-1 break-words" title={returnInsights.limitingFactor}>
                            {returnInsights.limitingFactor}
                          </span>
                        </div>
                        <div className="flex justify-between items-start gap-2">
                          <span className="text-gray-600 flex-shrink-0">Strongest support:</span>
                          <span className="font-semibold text-gray-900 text-right flex-1 break-words" title={returnInsights.strongestSupport}>
                            {returnInsights.strongestSupport}
                          </span>
                        </div>
                      </div>
                    </div>
                  )}
                  
                  {/* Recommended Position Sizing */}
                  {returnInsights && (
                    <div className="mt-4 p-3 bg-gray-50 rounded-lg border border-gray-200">
                      <div className="mb-2">
                        <h5 className="text-xs font-semibold text-gray-700 uppercase tracking-wide">Recommended Position Sizing</h5>
                      </div>
                      <div className="text-xs font-mono">
                        <div className="flex justify-between items-center">
                          <span className="text-gray-600">
                            {returnInsights.positionCategory}
                            {returnInsights.isGated && (
                              <span className="ml-1 text-gray-500 text-[10px]">(rare, gated)</span>
                            )}
                          </span>
                          {returnInsights.positionRange && (
                            <span className="font-semibold text-gray-900">
                              {returnInsights.positionRange}
                            </span>
                          )}
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </div>
            <div className="pt-3 border-t border-gray-200">
              <div className="mb-4">
                <div className="flex items-center justify-between mb-2">
                  <h4 className="text-sm font-semibold text-gray-700">Drivers</h4>
                  <button
                    onClick={() => {
                      setEditingDriver(null);
                      setNewDriverText('');
                      setShowAddDriver(true);
                    }}
                    className="px-2 py-1 text-xs font-medium text-blue-600 hover:text-blue-700 hover:bg-blue-50 rounded transition-colors"
                  >
                    + Add
                  </button>
                </div>
                
                {(thesis.drivers && thesis.drivers.length > 0) ? (
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                    {thesis.drivers.map((driver) => (
                      <div
                        key={driver.id}
                        className="bg-white rounded-lg p-3 border border-gray-200 hover:border-gray-300 hover:shadow-sm transition-all"
                      >
                        <div className="flex items-start justify-between mb-2">
                          <span className="text-base text-gray-900 flex-1 pr-2 leading-snug font-medium">
                            {driver.description}
                          </span>
                          <div className="flex items-center gap-1 flex-shrink-0">
                            <button
                              onClick={() => handleEditDriver(driver)}
                              className="p-1 text-gray-400 hover:text-blue-600 rounded transition-colors"
                              title="Edit driver"
                            >
                              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                              </svg>
                            </button>
                            <button
                              onClick={() => handleDeleteDriver(driver.id)}
                              className="p-1 text-gray-400 hover:text-red-600 rounded transition-colors"
                              title="Delete driver"
                            >
                              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                              </svg>
                            </button>
                          </div>
                        </div>
                        
                        <div className="space-y-2.5">
                          {/* Impact on Valuation - Calculated Text */}
                          <div className="flex items-center gap-2">
                            <span className="text-sm text-gray-500">Impact on Valuation:</span>
                            <span className="text-xs text-gray-700 font-medium">
                              {calculateImpactOnValuation(driver.confidence)}
                            </span>
                          </div>
                          
                          {/* Confidence Dropdown */}
                          <div>
                            <div className="flex items-center justify-between">
                              <span className="text-sm text-gray-500">Confidence</span>
                              <select
                                value={driver.confidence}
                                onChange={(e) => {
                                  const newValue = parseFloat(e.target.value);
                                  handleUpdateDriverConfidence(driver.id, newValue);
                                }}
                                className="text-xs text-gray-700 bg-white border border-gray-300 rounded-md px-2 py-1.5 focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                              >
                                {confidenceLevels.map((level) => (
                                  <option key={level.value} value={level.value}>
                                    {level.label}
                                  </option>
                                ))}
                              </select>
                            </div>
                          </div>
                          
                          {/* Reality Check */}
                          <div className="pt-2 border-t border-gray-200">
                            <div className="mb-2">
                              <span className="text-sm text-gray-500">Reality check</span>
                            </div>
                            <div className="flex items-start gap-3">
                              <p className="text-xs text-gray-700 leading-relaxed flex-1">
                                {getRealityCheckSummary(driver.confidence)}
                              </p>
                              <button
                                onClick={() => handleExplainRealityCheck(driver)}
                                className="px-2.5 py-1 text-xs font-medium text-blue-600 hover:text-blue-700 hover:bg-blue-50 border border-blue-200 rounded-md transition-colors flex-shrink-0"
                              >
                                Explain
                              </button>
                            </div>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="text-xs text-gray-500 py-2">
                    No drivers. Click "+ Add" to add factors that drive your expected return.
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Stock Value Chart - Baseline vs Thesis-accelerated */}
          {valueChartData.length > 0 && (
            <div className="mb-6 bg-gray-50 rounded-lg p-4 border border-gray-200">
              <h3 className="text-sm font-semibold text-gray-700 mb-4">Stock Value Projection</h3>
              <ResponsiveContainer width="100%" height={300}>
                <LineChart data={valueChartData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                  <XAxis 
                    dataKey="quarter" 
                    stroke="#6b7280"
                    fontSize={12}
                    angle={-45}
                    textAnchor="end"
                    height={80}
                  />
                  <YAxis 
                    stroke="#6b7280"
                    fontSize={12}
                    label={{ value: 'Value ($)', angle: -90, position: 'insideLeft' }}
                  />
                  <Tooltip 
                    contentStyle={{ backgroundColor: '#fff', border: '1px solid #e5e7eb', borderRadius: '8px' }}
                    formatter={(value: any, name: string) => {
                      if (name === 'baselineValue') {
                        return [`$${value.toFixed(2)}`, 'Baseline Value'];
                      }
                      if (name === 'thesisValue') {
                        return [`$${value.toFixed(2)}`, 'Thesis-accelerated Value'];
                      }
                      return [value, name];
                    }}
                    labelFormatter={(label) => `Quarter: ${label}`}
                  />
                  <Line 
                    type="monotone" 
                    dataKey="baselineValue" 
                    stroke="#94a3b8" 
                    strokeWidth={2}
                    strokeDasharray="5 5"
                    dot={{ fill: '#94a3b8', r: 4 }}
                    activeDot={{ r: 6 }}
                    name="baselineValue"
                  />
                  <Line 
                    type="monotone" 
                    dataKey="thesisValue" 
                    stroke="#3b82f6" 
                    strokeWidth={3}
                    dot={{ fill: '#3b82f6', r: 5 }}
                    activeDot={{ r: 7 }}
                    name="thesisValue"
                  />
                </LineChart>
              </ResponsiveContainer>
              <div className="mt-3 flex items-center justify-center gap-6 text-xs flex-wrap">
                <div className="flex items-center gap-2">
                  <div className="w-4 h-0.5 bg-slate-400 border-dashed"></div>
                  <span className="text-gray-600">Baseline Value (2% growth)</span>
                </div>
                <div className="flex items-center gap-2">
                  <div className="w-4 h-0.5 bg-blue-600"></div>
                  <span className="text-gray-600">Thesis-accelerated Value</span>
                </div>
              </div>
            </div>
          )}

          {/* KPI Charts Section - Smaller charts (half size) */}
          <div className="mb-6 grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* iPhone Sales Bar Chart - Stacked (Organic vs Thesis-based) with Historical Data */}
            {iPhoneSalesData.length > 0 && (
              <div className="bg-gray-50 rounded-lg p-4 border border-gray-200">
                <h3 className="text-sm font-semibold text-gray-700 mb-3">iPhone Sales</h3>
                <ResponsiveContainer width="100%" height={150}>
                <BarChart data={iPhoneSalesData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                  <XAxis 
                    dataKey="quarter" 
                    stroke="#6b7280"
                    fontSize={10}
                    angle={-45}
                    textAnchor="end"
                    height={60}
                  />
                  <YAxis 
                    stroke="#6b7280"
                    fontSize={10}
                    label={{ value: 'Revenue ($B)', angle: -90, position: 'insideLeft', style: { fontSize: '10px' } }}
                  />
                  <Tooltip 
                    contentStyle={{ backgroundColor: '#fff', border: '1px solid #e5e7eb', borderRadius: '8px', fontSize: '12px' }}
                    formatter={(value: any, name: string, props: any) => {
                      if (name === 'baseline' && value > 0) {
                        if (props.payload.isHistorical) {
                          return [`$${value}B`, 'Historical Revenue'];
                        }
                        return [`$${value}B`, 'Baseline (Historical + 2.5% organic growth)'];
                      }
                      if (name === 'thesisBased' && value > 0) {
                        return [`$${value}B`, 'Thesis-based Growth'];
                      }
                      return null;
                    }}
                    labelFormatter={(label) => `Quarter: ${label}`}
                  />
                  {/* Baseline: Historical + Organic Growth (combined) */}
                  <Bar 
                    dataKey="baseline" 
                    stackId="a"
                    fill="#94a3b8"
                    radius={[0, 0, 0, 0]}
                    name="baseline"
                  />
                  {/* Thesis-based Growth (stacked on top) */}
                  <Bar 
                    dataKey="thesisBased" 
                    stackId="a"
                    fill="#3b82f6"
                    radius={[4, 4, 0, 0]}
                    name="thesisBased"
                  />
                </BarChart>
              </ResponsiveContainer>
              <div className="mt-2 flex items-center justify-center gap-4 text-xs flex-wrap">
                <div className="flex items-center gap-1.5">
                  <div className="w-2.5 h-2.5 rounded bg-slate-400"></div>
                  <span className="text-gray-600">Baseline</span>
                </div>
                <div className="flex items-center gap-1.5">
                  <div className="w-2.5 h-2.5 rounded bg-blue-600"></div>
                  <span className="text-gray-600">Thesis Growth</span>
                </div>
              </div>
            </div>
          )}
          </div>
        </div>
      </div>

      {/* Right Side - Chat Interface */}
      <div className="w-[500px] bg-white flex flex-col border-l border-gray-200">
        {/* Chat Header */}
        <div className="border-b border-gray-200 p-4 bg-gray-50">
          <h2 className="text-lg font-semibold text-gray-900">Discuss Your Thesis</h2>
          <p className="text-xs text-gray-500 mt-1">Refine your investment idea and track drivers</p>
        </div>

        {/* Chat Messages */}
        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          {chatMessages.map((message) => (
            <div
              key={message.id}
              className={`flex gap-3 ${message.role === 'user' ? 'justify-end' : 'justify-start'}`}
            >
              {message.role === 'assistant' && (
                <div className="flex-shrink-0 w-8 h-8 rounded-full bg-blue-600 flex items-center justify-center">
                  <svg className="w-5 h-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
                  </svg>
                </div>
              )}
              <div
                className={`max-w-[80%] rounded-2xl px-4 py-3 ${
                  message.role === 'user'
                    ? 'bg-blue-600 text-white'
                    : 'bg-gray-100 text-gray-900'
                }`}
              >
                <div className="text-sm whitespace-pre-wrap leading-relaxed">{message.content}</div>
                <div className={`text-xs mt-2 ${
                  message.role === 'user' ? 'text-blue-100' : 'text-gray-500'
                }`}>
                  {new Date(message.timestamp).toLocaleTimeString('en-US', { 
                    hour: 'numeric', 
                    minute: '2-digit' 
                  })}
                </div>
              </div>
              {message.role === 'user' && (
                <div className="flex-shrink-0 w-8 h-8 rounded-full bg-gray-300 flex items-center justify-center">
                  <svg className="w-5 h-5 text-gray-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
                  </svg>
                </div>
              )}
            </div>
          ))}
          
          {isLoading && (
            <div className="flex gap-3 justify-start">
              <div className="flex-shrink-0 w-8 h-8 rounded-full bg-blue-600 flex items-center justify-center">
                <svg className="w-5 h-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
                </svg>
              </div>
              <div className="bg-gray-100 rounded-2xl px-4 py-3">
                <div className="flex gap-1">
                  <div className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
                  <div className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
                  <div className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
                </div>
              </div>
            </div>
          )}
          
          <div ref={chatEndRef} />
        </div>

        {/* Chat Input */}
        <div className="border-t border-gray-200 p-4 bg-gray-50">
          <div className="flex gap-2">
            <textarea
              ref={inputRef}
              value={inputValue}
              onChange={(e) => setInputValue(e.target.value)}
              onKeyPress={handleKeyPress}
              placeholder="Discuss your investment thesis..."
              className="flex-1 px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 resize-none"
              rows={3}
              disabled={isLoading}
            />
            <button
              onClick={handleSendMessage}
              disabled={!inputValue.trim() || isLoading}
              className="px-6 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:bg-gray-300 disabled:cursor-not-allowed transition-colors flex items-center justify-center"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8" />
              </svg>
            </button>
          </div>
          <p className="text-xs text-gray-500 mt-2">Press Enter to send, Shift+Enter for new line</p>
        </div>
      </div>

      {/* Add/Edit Driver Modal */}
      {showAddDriver && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl shadow-xl max-w-2xl w-full max-h-[90vh] overflow-y-auto">
            <div className="p-6">
              <div className="flex items-center justify-between mb-6">
                <h3 className="text-xl font-bold text-gray-900">
                  {editingDriver ? 'Edit Driver' : 'Add Driver'}
                </h3>
                <button
                  onClick={() => {
                    setShowAddDriver(false);
                    setEditingDriver(null);
                    setNewDriverText('');
                  }}
                  className="text-gray-400 hover:text-gray-600"
                >
                  <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>

              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-semibold text-gray-700 mb-2">
                    Driver Description *
                  </label>
                  <textarea
                    value={newDriverText}
                    onChange={(e) => setNewDriverText(e.target.value)}
                    rows={4}
                    className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                    placeholder="e.g., Margin improves as Services revenue mix increases"
                  />
                  <p className="text-xs text-gray-500 mt-2">
                    Describe a factor that will drive your expected return (e.g., margin expansion, multiple expansion, revenue growth)
                  </p>
                </div>
              </div>

              <div className="flex gap-3 mt-6">
                <button
                  onClick={editingDriver ? handleSaveDriver : handleAddDriver}
                  disabled={!newDriverText.trim()}
                  className="flex-1 px-6 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors font-medium disabled:bg-gray-300 disabled:cursor-not-allowed"
                >
                  {editingDriver ? 'Save Driver' : 'Add Driver'}
                </button>
                <button
                  onClick={() => {
                    setShowAddDriver(false);
                    setEditingDriver(null);
                    setNewDriverText('');
                  }}
                  className="px-6 py-2 bg-gray-200 text-gray-700 rounded-lg hover:bg-gray-300 transition-colors font-medium"
                >
                  Cancel
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
