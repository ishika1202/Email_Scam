// Simplified Background Service for Testing
console.log('🛡️ SponsorGuard Background Service Starting...');

class SimpleBackgroundService {
  constructor() {
    this.aiAnalysisEndpoint = 'http://localhost:3000/api/verify';
    this.stats = {
      scannedEmails: 0,
      sponsorEmails: 0,
      docsUpdates: 0
    };
    this.setupListeners();
    console.log('✅ Background service initialized');
  }

  setupListeners() {
    chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
      console.log('📨 Received message:', request.action);
      this.handleMessage(request, sender, sendResponse);
      return true;
    });

    chrome.runtime.onInstalled.addListener(() => {
      console.log('🚀 Extension installed/updated');
      this.loadStats();
    });
  }

  async handleMessage(request, sender, sendResponse) {
    try {
      switch (request.action) {
        case 'analyzeEmail':
          console.log('🔍 Analyzing email:', request.data.subject);
          const analysis = await this.analyzeEmailWithAI(request.data);
          await this.updateStats('scannedEmails');
          if (analysis.isSponsor) {
            await this.updateStats('sponsorEmails');
          }
          sendResponse(analysis);
          break;

        case 'saveToGoogleDocs':
          console.log('📄 Would save to Google Docs:', request.data.originalEmail?.subject);
          await this.updateStats('docsUpdates');
          sendResponse({ success: true });
          break;

        case 'getGoogleDocsUrl':
          sendResponse({ url: 'https://docs.google.com' });
          break;

        case 'getStats':
          await this.loadStats();
          sendResponse(this.stats);
          break;

        case 'refresh':
          console.log('🔄 Refresh requested');
          chrome.tabs.query({active: true, currentWindow: true}, (tabs) => {
            if (tabs[0]) {
              chrome.tabs.sendMessage(tabs[0].id, { action: 'resetProcessed' });
            }
          });
          sendResponse({ success: true });
          break;

        default:
          sendResponse({ error: 'Unknown action' });
      }
    } catch (error) {
      console.error('❌ Background service error:', error);
      sendResponse({ error: error.message });
    }
  }

  async analyzeEmailWithAI(emailData) {
    try {
      console.log('🤖 Calling AI API...');
      
      const response = await fetch(this.aiAnalysisEndpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ 
          emailContent: `
Subject: ${emailData.subject}
From: ${emailData.sender}
Body: ${emailData.body}
          `.trim()
        }),
      });

      if (!response.ok) {
        throw new Error(`Analysis failed: ${response.status}`);
      }

      const result = await response.json();
      console.log('✅ AI analysis completed, risk score:', result.riskScore);
      
      const isSponsor = this.determineSponsorStatus(result, emailData);
      
      return {
        ...result,
        isSponsor,
        originalEmail: emailData,
        processedAt: new Date().toISOString()
      };

    } catch (error) {
      console.error('❌ AI analysis error:', error);
      return {
        error: error.message,
        isSponsor: this.fallbackSponsorDetection(emailData),
        originalEmail: emailData,
        riskScore: 50,
        status: 'warning',
        flags: [{ type: 'yellow', message: 'API unavailable - using fallback detection' }],
        extractedInfo: this.extractBasicInfo(emailData)
      };
    }
  }

  determineSponsorStatus(analysisResult, emailData) {
    const sponsorKeywords = [
      'sponsor', 'partnership', 'collaboration', 'brand deal',
      'influencer', 'campaign', 'promotion', 'advertising',
      'content creator', 'social media', 'youtube', 'instagram',
      'tiktok', 'brand ambassador', 'affiliate', 'marketing',
      'product placement', 'endorsement', 'paid post'
    ];

    const emailText = (emailData.subject + ' ' + emailData.body).toLowerCase();
    const hasKeywords = sponsorKeywords.some(keyword => 
      emailText.includes(keyword)
    );

    const lowRisk = analysisResult.riskScore && analysisResult.riskScore < 40;
    const hasBusinessInfo = analysisResult.extractedInfo?.companyName || 
                           analysisResult.extractedInfo?.website;
    
    const professionalSender = emailData.sender && 
      !emailData.sender.includes('gmail.com') && 
      !emailData.sender.includes('yahoo.com') &&
      !emailData.sender.includes('hotmail.com');

    return hasKeywords && (lowRisk || hasBusinessInfo || professionalSender);
  }

  fallbackSponsorDetection(emailData) {
    const sponsorKeywords = [
      'sponsor', 'partnership', 'collaboration', 'brand deal',
      'influencer', 'campaign', 'promotion', 'advertising'
    ];
    
    const emailText = (emailData.subject + ' ' + emailData.body).toLowerCase();
    return sponsorKeywords.some(keyword => emailText.includes(keyword));
  }

  extractBasicInfo(emailData) {
    const text = emailData.body.toLowerCase();
    
    const companyMatch = text.match(/(?:from|at|with|representing)\s+([A-Z][a-zA-Z\s&]+(?:Inc|LLC|Corp|Company|Ltd))/i);
    const websiteMatch = emailData.body.match(/https?:\/\/[^\s<>"{}|\\^`[\]]+/);
    
    return {
      companyName: companyMatch ? companyMatch[1].trim() : 'Not specified',
      website: websiteMatch ? websiteMatch[0] : 'Not specified',
      contactPerson: emailData.sender || 'Not specified',
      offer: 'Please check email for details'
    };
  }

  async updateStats(statType) {
    this.stats[statType]++;
    await chrome.storage.local.set({ [statType]: this.stats[statType] });
    console.log(`📊 Updated ${statType}:`, this.stats[statType]);
  }

  async loadStats() {
    const result = await chrome.storage.local.get([
      'scannedEmails', 'sponsorEmails', 'docsUpdates'
    ]);
    
    this.stats = {
      scannedEmails: result.scannedEmails || 0,
      sponsorEmails: result.sponsorEmails || 0,
      docsUpdates: result.docsUpdates || 0
    };
    console.log('📊 Loaded stats:', this.stats);
  }
}

// Initialize background service
try {
  new SimpleBackgroundService();
} catch (error) {
  console.error('❌ Failed to initialize background service:', error);
} 