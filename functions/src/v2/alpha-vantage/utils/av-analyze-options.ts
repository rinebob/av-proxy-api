import { AvOptionContract, SvtExpirationAnalysis, SvtOptionsAnalysis, SvtStrikeAnalysis } from "@shared/alpha-vantage";

interface ExpirationSummary {
  [expiration: string]: number;
}

function formatTimeUntilExpiration(expirationDate: string, expirations: ExpirationSummary): string {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const expDate = new Date(expirationDate);
  expDate.setHours(0, 0, 0, 0);
  
  const diffTime = expDate.getTime() - today.getTime();
  const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
  
  if (diffDays < 0) return '0 days';
  
  // Calculate weeks difference
  const startOfWeek = (date: Date) => {
    const d = new Date(date);
    const day = d.getDay();
    const diff = d.getDate() - day + (day === 0 ? -6 : 1); // Adjust when day is Sunday
    return new Date(d.setDate(diff));
  };
  
  const startOfThisWeek = startOfWeek(today);
  const startOfExpWeek = startOfWeek(expDate);
  const diffWeeks = Math.round((startOfExpWeek.getTime() - startOfThisWeek.getTime()) / (7 * 24 * 60 * 60 * 1000)) / 1;
  
  if (diffDays < 7) {
    return `${diffDays} ${diffDays === 1 ? 'day' : 'days'}`;
  } else if (diffWeeks < 4) {
    const weeks = Math.ceil(diffWeeks);
    return `${weeks} ${weeks === 1 ? 'week' : 'weeks'}`;
  } else {
    // Check if there are multiple expirations in the same month
    const month = expDate.getMonth();
    const year = expDate.getFullYear();
    const firstDayOfMonth = new Date(year, month, 1);
    const lastDayOfMonth = new Date(year, month + 1, 0);
    
    // Count number of expirations in this month
    const allExpirations = Object.keys(expirations).map(d => new Date(d));
    const expirationsThisMonth = allExpirations.filter(d => 
      d >= firstDayOfMonth && d <= lastDayOfMonth
    ).length;
    
    if (expirationsThisMonth > 1) {
      // If multiple expirations in the same month, use weeks
      return `${Math.ceil(diffWeeks)} weeks`;
    } else {
      // Otherwise use months
      const months = Math.floor(diffDays / 30);
      return `${months} ${months === 1 ? 'month' : 'months'}`;
    }
  }
}

export function analyzeOptions(optionsData: AvOptionContract[]): SvtOptionsAnalysis {
  // Count by expiration and collect stats
  const expirations: Record<string, Omit<SvtExpirationAnalysis, 'expiration' | 'timeUntilExpiration'>> = {};
  const strikes: Record<string, Omit<SvtStrikeAnalysis, 'strike' | 'totalVolume' | 'totalOpenInterest'>> = {};
  
  // Filter out contracts with missing required fields
  const validContracts = optionsData.filter(contract => 
    contract.expiration && 
    contract.volume !== undefined && 
    contract.open_interest !== undefined &&
    contract.type &&
    contract.strike
  );

  validContracts.forEach((contract) => {
    const { expiration, volume, open_interest, type, strike } = contract;
    const volumeNum = parseInt(volume || '0', 10) || 0;
    const oiNum = parseInt(open_interest || '0', 10) || 0;
    const isCall = type === 'call';

    // Initialize expiration if not exists
    if (!expirations[expiration!]) {
      expirations[expiration!] = {
        contractCount: 0,
        callVolume: 0,
        putVolume: 0,
        callOpenInterest: 0,
        putOpenInterest: 0
      };
    }
    
    // Initialize strike if not exists
    if (!strikes[strike!]) {
      strikes[strike!] = {
        callVolume: 0,
        putVolume: 0,
        callOpenInterest: 0,
        putOpenInterest: 0
      };
    }

    // Update expiration stats
    expirations[expiration!].contractCount++;
    if (isCall) {
      expirations[expiration!].callVolume += volumeNum;
      expirations[expiration!].callOpenInterest += oiNum;
    } else {
      expirations[expiration!].putVolume += volumeNum;
      expirations[expiration!].putOpenInterest += oiNum;
    }

    // Update strike stats
    if (isCall) {
      strikes[strike!].callVolume += volumeNum;
      strikes[strike!].callOpenInterest += oiNum;
    } else {
      strikes[strike!].putVolume += volumeNum;
      strikes[strike!].putOpenInterest += oiNum;
    }
  });

  // Calculate totals
  const totalCallContracts = Object.values(expirations).reduce((sum, exp) => 
    sum + (exp.callVolume > 0 ? 1 : 0), 0
  );
  
  const totalPutContracts = Object.values(expirations).reduce((sum, exp) => 
    sum + (exp.putVolume > 0 ? 1 : 0), 0
  );
  
  const totalVolume = Object.values(expirations).reduce((sum, exp) => 
    sum + exp.callVolume + exp.putVolume, 0
  );
  
  const totalOpenInterest = Object.values(expirations).reduce((sum, exp) => 
    sum + exp.callOpenInterest + exp.putOpenInterest, 0
  );
  
  const totalContracts = validContracts.length;
  const uniqueStrikesCount = Object.keys(strikes).length;
  
  // Create a simple count object for formatTimeUntilExpiration
  const expirationCounts: ExpirationSummary = {};
  Object.entries(expirations).forEach(([date, exp]) => {
    expirationCounts[date] = exp.contractCount;
  });

  // Format expiration details with time until expiration
  const expirationDetails: SvtExpirationAnalysis[] = Object.entries(expirations).map(([date, exp]) => ({
    expiration: date,
    contractCount: exp.contractCount,
    timeUntilExpiration: formatTimeUntilExpiration(date, expirationCounts),
    callVolume: exp.callVolume,
    putVolume: exp.putVolume,
    callOpenInterest: exp.callOpenInterest,
    putOpenInterest: exp.putOpenInterest
  })).sort((a, b) => new Date(a.expiration).getTime() - new Date(b.expiration).getTime());
  
  // Format strike details
  const strikeDetails: SvtStrikeAnalysis[] = Object.entries(strikes).map(([strike, data]) => ({
    strike,
    callVolume: data.callVolume,
    putVolume: data.putVolume,
    callOpenInterest: data.callOpenInterest,
    putOpenInterest: data.putOpenInterest,
    totalVolume: data.callVolume + data.putVolume,
    totalOpenInterest: data.callOpenInterest + data.putOpenInterest
  })).sort((a, b) => parseFloat(a.strike) - parseFloat(b.strike));

  return {
    summary: {
      totalContracts,
      totalVolume,
      totalOpenInterest,
      callContracts: totalCallContracts,
      putContracts: totalPutContracts,
      uniqueStrikes: uniqueStrikesCount,
      avgVolumePerContract: totalContracts > 0 ? parseFloat((totalVolume / totalContracts).toFixed(2)) : 0,
      avgOpenInterest: totalContracts > 0 ? parseFloat((totalOpenInterest / totalContracts).toFixed(2)) : 0
    },
    expirations: expirationDetails,
    strikes: strikeDetails
  };
}
