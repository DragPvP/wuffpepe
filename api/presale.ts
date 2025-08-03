import { VercelRequest, VercelResponse } from '@vercel/node';
import { storage } from '../server/storage';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'GET') {
    return res.status(405).json({ message: 'Method not allowed' });
  }

  try {
    const presaleData = await storage.getPresaleData();
    
    // Calculate percentage
    const totalRaised = parseFloat(presaleData.totalRaised);
    const goalAmount = parseFloat(presaleData.totalSupply); // Using totalSupply field as goal amount
    const percentage = goalAmount > 0 ? (totalRaised / goalAmount) * 100 : 0;
    
    res.json({
      ...presaleData,
      percentage: percentage.toFixed(2)
    });
  } catch (error) {
    res.status(500).json({ message: "Failed to fetch presale data" });
  }
}