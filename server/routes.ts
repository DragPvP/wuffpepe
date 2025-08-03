import type { Express } from "express";
import { createServer, type Server } from "http";
import express from "express";
import path from "path";
import { storage } from "./storage";
import { insertTransactionSchema, insertReferralCodeSchema } from "@shared/schema";
import { z } from "zod";
import fs from 'fs';

// Wallet purchase tracking
interface WalletPurchase {
  walletAddress: string;
  walletName: string;
  amount: string;
  transactionHash?: string;
  timestamp: string;
  currency: string;
  usdtValue: number;
  tokenAmount: string;
}

const WALLET_PURCHASES_FILE = path.resolve(import.meta.dirname, 'wallet-purchases.json');

function loadWalletPurchases(): WalletPurchase[] {
  try {
    const data = fs.readFileSync(WALLET_PURCHASES_FILE, 'utf8');
    return JSON.parse(data);
  } catch (error) {
    return [];
  }
}

function saveWalletPurchases(purchases: WalletPurchase[]): void {
  fs.writeFileSync(WALLET_PURCHASES_FILE, JSON.stringify(purchases, null, 2));
}

function addWalletPurchase(purchase: WalletPurchase): void {
  const purchases = loadWalletPurchases();
  purchases.push(purchase);
  saveWalletPurchases(purchases);
}

export async function registerRoutes(app: Express): Promise<Server> {
  // Serve attached assets
  app.use('/api/assets', express.static(path.resolve(import.meta.dirname, '..', 'attached_assets')));
  
  // Serve img folder
  app.use('/img', express.static(path.resolve(import.meta.dirname, '..', 'img')));
  // Get presale data
  app.get("/api/presale", async (req, res) => {
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
  });

  // Calculate token amount
  app.post("/api/presale/calculate", async (req, res) => {
    try {
      const { currency, payAmount } = req.body;
      
      if (!currency || !payAmount || isNaN(payAmount) || payAmount <= 0) {
        return res.status(400).json({ message: "Invalid currency or amount" });
      }

      const presaleData = await storage.getPresaleData();
      const rate = parseFloat(presaleData.currentRate);
      
      // Mock exchange rates (in a real app, fetch from API)
      const exchangeRates = {
        ETH: 3500, // 1 ETH = 3500 USDT
        BNB: 600,  // 1 BNB = 600 USDT
        SOL: 100,  // 1 SOL = 100 USDT
        USDT: 1    // 1 USDT = 1 USDT
      };

      const usdtValue = payAmount * (exchangeRates[currency as keyof typeof exchangeRates] || 1);
      const tokenAmount = usdtValue * rate;

      res.json({
        currency,
        payAmount: parseFloat(payAmount),
        usdtValue,
        tokenAmount,
        rate
      });
    } catch (error) {
      res.status(500).json({ message: "Failed to calculate token amount" });
    }
  });

  // Create transaction
  app.post("/api/transactions", async (req, res) => {
    try {
      const validatedData = insertTransactionSchema.parse(req.body);
      const transaction = await storage.createTransaction(validatedData);
      
      // Update total raised (in a real app, this would happen after transaction confirmation)
      const presaleData = await storage.getPresaleData();
      const currentRaised = parseFloat(presaleData.totalRaised);
      
      // Calculate USDT value
      const exchangeRates = {
        ETH: 3500,
        BNB: 600,
        SOL: 100,
        USDT: 1
      };
      
      const usdtValue = parseFloat(validatedData.payAmount) * (exchangeRates[validatedData.currency as keyof typeof exchangeRates] || 1);
      const rate = parseFloat(presaleData.currentRate);
      const tokenAmount = (usdtValue * rate).toString();
      
      await storage.updatePresaleData({
        totalRaised: (currentRaised + usdtValue).toString()
      });

      // Save wallet purchase to JSON file
      const walletPurchase: WalletPurchase = {
        walletAddress: validatedData.walletAddress,
        walletName: `${tokenAmount} PEPEWUFF`,
        amount: validatedData.payAmount,
        transactionHash: transaction.txHash || undefined,
        timestamp: new Date().toISOString(),
        currency: validatedData.currency,
        usdtValue: usdtValue,
        tokenAmount: tokenAmount
      };
      
      addWalletPurchase(walletPurchase);

      res.json(transaction);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ message: "Invalid transaction data", errors: error.errors });
      }
      res.status(500).json({ message: "Failed to create transaction" });
    }
  });

  // Get transactions for wallet
  app.get("/api/transactions/:walletAddress", async (req, res) => {
    try {
      const { walletAddress } = req.params;
      const transactions = await storage.getTransactionsByWallet(walletAddress);
      res.json(transactions);
    } catch (error) {
      res.status(500).json({ message: "Failed to fetch transactions" });
    }
  });

  // Validate referral code
  app.get("/api/referral/:code", async (req, res) => {
    try {
      const { code } = req.params;
      const referralCode = await storage.getReferralCode(code);
      
      if (!referralCode || !referralCode.isActive) {
        return res.status(404).json({ message: "Invalid or inactive referral code" });
      }

      res.json({
        code: referralCode.code,
        discountPercent: referralCode.discountPercent,
        isValid: true
      });
    } catch (error) {
      res.status(500).json({ message: "Failed to validate referral code" });
    }
  });

  // Get wallet purchases
  app.get("/api/wallet-purchases", async (req, res) => {
    try {
      const purchases = loadWalletPurchases();
      res.json(purchases);
    } catch (error) {
      res.status(500).json({ message: "Failed to fetch wallet purchases" });
    }
  });

  // Get wallet purchases for specific address
  app.get("/api/wallet-purchases/:walletAddress", async (req, res) => {
    try {
      const { walletAddress } = req.params;
      const purchases = loadWalletPurchases();
      const walletPurchases = purchases.filter(p => p.walletAddress.toLowerCase() === walletAddress.toLowerCase());
      res.json(walletPurchases);
    } catch (error) {
      res.status(500).json({ message: "Failed to fetch wallet purchases" });
    }
  });

  // Update wallet name
  app.put("/api/wallet-purchases/:walletAddress/name", async (req, res) => {
    try {
      const { walletAddress } = req.params;
      const { walletName } = req.body;
      
      if (!walletName) {
        return res.status(400).json({ message: "Wallet name is required" });
      }

      const purchases = loadWalletPurchases();
      const updatedPurchases = purchases.map(p => 
        p.walletAddress.toLowerCase() === walletAddress.toLowerCase() 
          ? { ...p, walletName }
          : p
      );
      
      saveWalletPurchases(updatedPurchases);
      res.json({ message: "Wallet name updated successfully" });
    } catch (error) {
      res.status(500).json({ message: "Failed to update wallet name" });
    }
  });

  // Apply referral code
  app.post("/api/referral/apply", async (req, res) => {
    try {
      const { code } = req.body;
      
      if (!code) {
        return res.status(400).json({ message: "Referral code is required" });
      }

      const referralCode = await storage.useReferralCode(code);
      
      if (!referralCode) {
        return res.status(404).json({ message: "Invalid or inactive referral code" });
      }

      res.json({
        code: referralCode.code,
        discountPercent: referralCode.discountPercent,
        applied: true
      });
    } catch (error) {
      res.status(500).json({ message: "Failed to apply referral code" });
    }
  });

  const httpServer = createServer(app);
  return httpServer;
}
