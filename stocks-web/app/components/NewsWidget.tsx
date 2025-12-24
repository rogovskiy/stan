'use client';

interface NewsItem {
  title: string;
  source: string;
  timeAgo: string;
  url?: string;
}

interface NewsWidgetProps {
  ticker: string;
}

export default function NewsWidget({ ticker }: NewsWidgetProps) {
  // Mock news data
  const newsItems: NewsItem[] = [
    {
      title: 'Apple Reports Strong Q2 Earnings, Services Revenue Hits Record High',
      source: 'Reuters',
      timeAgo: '2 hours ago'
    },
    {
      title: 'New iPhone Models Drive Strong Sales in China Market',
      source: 'Bloomberg',
      timeAgo: '5 hours ago'
    },
    {
      title: 'Apple Announces Major AI Features Coming to iOS 18',
      source: 'TechCrunch',
      timeAgo: '1 day ago'
    },
    {
      title: 'Analysts Raise Price Target Following Services Growth',
      source: 'CNBC',
      timeAgo: '1 day ago'
    },
    {
      title: 'Apple Expands Manufacturing Operations in India',
      source: 'Wall Street Journal',
      timeAgo: '2 days ago'
    }
  ];

  return (
    <div className="bg-white rounded-xl shadow-md border border-gray-200 p-6">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-lg font-bold text-gray-900">News</h3>
        <button className="text-sm text-blue-600 hover:text-blue-700 font-medium">
          View All
        </button>
      </div>
      
      <div className="space-y-4">
        {newsItems.map((item, idx) => (
          <a
            key={idx}
            href="#"
            className="block group hover:bg-gray-50 rounded-lg p-3 -m-3 transition-colors"
            onClick={(e) => e.preventDefault()}
          >
            <h4 className="text-sm font-semibold text-gray-900 mb-2 group-hover:text-blue-600 transition-colors line-clamp-2">
              {item.title}
            </h4>
            <div className="flex items-center gap-2 text-xs text-gray-500">
              <span>{item.source}</span>
              <span>•</span>
              <span>{item.timeAgo}</span>
            </div>
          </a>
        ))}
      </div>
    </div>
  );
}

