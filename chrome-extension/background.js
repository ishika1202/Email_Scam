// Background service worker for AI analysis and Google Docs integration
class BackgroundService {
  constructor() {
    this.aiAnalysisEndpoint = 'http://localhost:3000/api/verify'; // Next.js API
    this.googleDocsId = '1fPdI3TvMwjRsCYo7nZdtlGnqq2BCZH1XlYPdEQOFits'; // Your Google Doc
    this.stats = {
      scannedEmails: 0,
      sponsorEmails: 0,
      docsUpdates: 0
    };
    this.recentActivities = [];
    this.maxActivities = 20;
    this.setupListeners();
  }

  setupListeners() {
    chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
      this.handleMessage(request, sender, sendResponse);
      return true; // Keep message channel open for async response
    });

    chrome.runtime.onInstalled.addListener(() => {
      // Skip Google Docs auth for now - we'll manually create document
      this.loadStats();
    });
  }

  async handleMessage(request, sender, sendResponse) {
    try {
      switch (request.action) {
        case 'analyzeEmail':
          const analysis = await this.analyzeEmailWithAI(request.data);
          await this.updateStats('scannedEmails');
          if (analysis.isSponsor) {
            await this.updateStats('sponsorEmails');
          }
          sendResponse(analysis);
          break;

        case 'saveToGoogleDocs':
          await this.saveToGoogleDocs(request.data);
          await this.updateStats('docsUpdates');
          sendResponse({ success: true });
          break;

        case 'getGoogleDocsUrl':
          // Open your specific Google Doc
          const url = `https://docs.google.com/document/d/${this.googleDocsId}/edit`;
          sendResponse({ url });
          break;

        case 'getStats':
          await this.loadStats();
          sendResponse(this.stats);
          break;

        case 'refresh':
          // Reset processed emails to re-scan
          chrome.tabs.query({active: true, currentWindow: true}, (tabs) => {
            if (tabs[0]) {
              chrome.tabs.sendMessage(tabs[0].id, { action: 'resetProcessed' });
            }
          });
          sendResponse({ success: true });
          break;

        case 'getRecentActivity':
          sendResponse({ activities: this.recentActivities });
          break;

        case 'generateSummary':
          const summary = await this.generateEmailSummary(request.data);
          sendResponse({ summary });
          break;

        default:
          sendResponse({ error: 'Unknown action' });
      }
    } catch (error) {
      console.error('Background service error:', error);
      sendResponse({ error: error.message });
    }
  }

  async analyzeEmailWithAI(emailData) {
    try {
      console.log('Analyzing email with AI:', emailData.subject);
      this.addActivity({
        type: 'scanned',
        message: `Analyzing: ${emailData.subject}`,
        timestamp: new Date().toISOString()
      });
      
      // Use the existing Next.js API endpoint
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
      
      // Enhanced sponsor detection logic
      const isSponsor = this.determineSponsorStatus(result, emailData);
      
      const finalResult = {
        ...result,
        isSponsor,
        originalEmail: emailData,
        processedAt: new Date().toISOString()
      };

      if (isSponsor) {
        this.addActivity({
          type: 'sponsor',
          message: `Sponsor detected: ${emailData.subject}`,
          timestamp: new Date().toISOString()
        });
        
        // Send detailed sponsor data to popup for local storage
        const sponsorData = {
          companyName: result.extractedInfo?.companyName || this.extractCompanyFromEmail(emailData) || 'Unknown Company',
          website: result.extractedInfo?.website || this.extractWebsiteFromEmail(emailData) || 'Not provided',
          agenda: result.extractedInfo?.offer || result.extractedInfo?.agenda || this.extractAgendaFromEmail(emailData) || 'Sponsorship opportunity',
          riskScore: result.riskScore || 0,
          contactPerson: result.extractedInfo?.contactPerson || this.extractContactFromEmail(emailData) || emailData.sender || 'Not specified',
          moneyOffered: this.extractMoneyFromEmail(emailData) || 'Not specified',
          emailSubject: emailData.subject,
          timestamp: new Date().toISOString(),
          extractedInfo: result.extractedInfo || {}
        };
        
        // Send to popup for local storage
        try {
          chrome.runtime.sendMessage({
            type: 'sponsorDetected',
            data: sponsorData
          }).catch(() => {}); // Ignore if popup not open
        } catch (error) {
          // Popup not open, ignore
        }
      }

      return finalResult;

    } catch (error) {
      console.error('AI analysis error:', error);
      // Return fallback analysis for offline mode
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
    // Enhanced sponsor detection combining AI analysis with keyword matching
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

    // Combine multiple signals:
    // 1. Low risk score (indicates legitimate business)
    // 2. Has business info extracted
    // 3. Contains sponsor keywords
    // 4. Professional email patterns
    
    const lowRisk = analysisResult.riskScore && analysisResult.riskScore < 40;
    const hasBusinessInfo = analysisResult.extractedInfo?.companyName || 
                           analysisResult.extractedInfo?.website;
    
    const professionalSender = emailData.sender && 
      !emailData.sender.includes('gmail.com') && 
      !emailData.sender.includes('yahoo.com') &&
      !emailData.sender.includes('hotmail.com');

    // Must have keywords AND at least one other positive signal
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
    
    // Basic company name extraction
    const companyMatch = text.match(/(?:from|at|with|representing)\s+([A-Z][a-zA-Z\s&]+(?:Inc|LLC|Corp|Company|Ltd))/i);
    
    // Basic website extraction
    const websiteMatch = emailData.body.match(/https?:\/\/[^\s<>"{}|\\^`[\]]+/);
    
    return {
      companyName: companyMatch ? companyMatch[1].trim() : 'Not specified',
      website: websiteMatch ? websiteMatch[0] : 'Not specified',
      offer: 'Potential business opportunity detected'
    };
  }

  extractCompanyFromEmail(emailData) {
    const text = emailData.body.toLowerCase();
    
    // Look for company patterns
    const companyPatterns = [
      /(?:from|at|with|for)\s+([A-Z][a-zA-Z\s&.,-]{2,30}(?:Inc|LLC|Corp|Ltd|Company|Co\.|Group))/i,
      /I(?:'m| am)\s+from\s+([A-Z][a-zA-Z\s&.,-]{2,30})/i,
      /we(?:'re| are)\s+([A-Z][a-zA-Z\s&.,-]{2,30})/i,
      /([A-Z][a-zA-Z\s&.,-]{2,30})\s+(?:company|brand|business|startup)/i
    ];

    for (const pattern of companyPatterns) {
      const match = emailData.body.match(pattern);
      if (match) {
        return match[1].trim();
      }
    }

    // Extract from email domain
    const emailMatch = emailData.sender.match(/@([^.]+)/);
    if (emailMatch) {
      return this.capitalizeWords(emailMatch[1]);
    }

    return null;
  }

  extractWebsiteFromEmail(emailData) {
    const text = emailData.body;
    
    // Look for website URLs
    const urlPatterns = [
      /https?:\/\/(?:www\.)?([a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/g,
      /(?:website|site|visit|check out).*?(www\.)?([a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/i
    ];

    for (const pattern of urlPatterns) {
      const matches = text.matchAll(pattern);
      for (const match of matches) {
        const domain = match[1] || match[2];
        if (domain && !domain.includes('gmail') && !domain.includes('google')) {
          return domain.startsWith('www.') ? domain : `www.${domain}`;
        }
      }
    }

    // Extract from sender email domain
    const emailMatch = emailData.sender.match(/@([a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/);
    if (emailMatch) {
      return `www.${emailMatch[1]}`;
    }

    return null;
  }

  extractAgendaFromEmail(emailData) {
    const text = emailData.body;
    
    // Look for opportunity/proposal descriptions
    const agendaPatterns = [
      /(?:we|I)(?:'d| would) (?:like|love) to (?:offer|propose|discuss|partner|collaborate)([^.!?]{10,100})/i,
      /(?:opportunity|proposal|partnership|collaboration|deal)(?:\s+is)?([^.!?]{10,100})/i,
      /(?:looking for|seeking|interested in)([^.!?]{10,100})/i,
      /(?:sponsor|promote|feature|review|endorse)([^.!?]{10,100})/i
    ];

    for (const pattern of agendaPatterns) {
      const match = text.match(pattern);
      if (match) {
        return match[1].trim();
      }
    }

    // Fallback: first meaningful sentence
    const sentences = text.split(/[.!?]+/);
    for (const sentence of sentences) {
      if (sentence.length > 20 && sentence.length < 150) {
        const cleaned = sentence.trim();
        if (this.containsSponsorKeywords(cleaned)) {
          return cleaned;
        }
      }
    }

    return 'Sponsorship opportunity detected';
  }

  extractContactFromEmail(emailData) {
    const text = emailData.body;
    
    // Look for name patterns
    const namePatterns = [
      /(?:I'm|I am|My name is|This is)\s+([A-Z][a-zA-Z\s]{2,25})/i,
      /(?:Best regards|Sincerely|Thanks),?\s*([A-Z][a-zA-Z\s]{2,25})/i,
      /From:\s*([A-Z][a-zA-Z\s]{2,25})/i
    ];

    for (const pattern of namePatterns) {
      const match = text.match(pattern);
      if (match) {
        const name = match[1].trim();
        // Avoid generic words
        if (!['Team', 'Support', 'Marketing', 'Sales'].includes(name)) {
          return name;
        }
      }
    }

    // Extract name from email address
    const emailMatch = emailData.sender.match(/^([a-zA-Z.]+)@/);
    if (emailMatch) {
      const name = emailMatch[1].replace(/[._]/g, ' ');
      return this.capitalizeWords(name);
    }

    return null;
  }

  extractMoneyFromEmail(emailData) {
    const text = emailData.body;
    
    // Look for money amounts
    const moneyPatterns = [
      /\$([0-9,]+(?:\.[0-9]{2})?)/g,
      /([0-9,]+)\s*(?:dollars?|USD|usd)/gi,
      /(?:pay|offer|budget|compensation|fee).*?\$?([0-9,]+)/gi,
      /([0-9,]+)\s*(?:per|for)\s+(?:post|video|review|mention)/gi
    ];

    const amounts = [];
    for (const pattern of moneyPatterns) {
      const matches = text.matchAll(pattern);
      for (const match of matches) {
        const amount = match[1].replace(/,/g, '');
        if (parseInt(amount) > 0) {
          amounts.push(`$${match[1]}`);
        }
      }
    }

    if (amounts.length > 0) {
      return amounts[0]; // Return first amount found
    }

    // Look for non-specific money mentions
    const moneyMentions = [
      /(?:competitive|good|fair|generous)\s+(?:compensation|payment|fee)/i,
      /(?:paid|paying)\s+(?:opportunity|partnership|collaboration)/i,
      /(?:budget|compensation|payment).*?(?:available|negotiable|discussed)/i
    ];

    for (const pattern of moneyMentions) {
      if (text.match(pattern)) {
        return 'Compensation mentioned';
      }
    }

    return 'Not specified';
  }

  containsSponsorKeywords(text) {
    const sponsorKeywords = [
      'sponsor', 'partnership', 'collaboration', 'brand deal',
      'influencer', 'campaign', 'promotion', 'advertising'
    ];
    
    const lowerText = text.toLowerCase();
    return sponsorKeywords.some(keyword => lowerText.includes(keyword));
  }

  capitalizeWords(str) {
    return str.split(' ').map(word => 
      word.charAt(0).toUpperCase() + word.slice(1).toLowerCase()
    ).join(' ');
  }

  async updateStats(statType) {
    this.stats[statType]++;
    await chrome.storage.local.set({ [statType]: this.stats[statType] });
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
  }

  async initializeGoogleDocs() {
    try {
      const result = await chrome.storage.local.get(['googleDocsId']);
      if (!result.googleDocsId) {
        const docId = await this.createSponsorTrackingDoc();
        await chrome.storage.local.set({ googleDocsId: docId });
        this.googleDocsId = docId;
      } else {
        this.googleDocsId = result.googleDocsId;
      }
    } catch (error) {
      console.error('Google Docs initialization error:', error);
    }
  }

  async getGoogleToken() {
    return new Promise((resolve, reject) => {
      chrome.identity.getAuthToken({ interactive: true }, (token) => {
        if (chrome.runtime.lastError) {
          reject(chrome.runtime.lastError);
        } else {
          resolve(token);
        }
      });
    });
  }

  async createSponsorTrackingDoc() {
    const token = await this.getGoogleToken();
    const today = new Date().toLocaleDateString();
    
    const response = await fetch('https://docs.googleapis.com/v1/documents', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        title: `SponsorGuard Tracker - ${today}`
      }),
    });

    const doc = await response.json();
    
    // Add initial content
    await this.updateDocContent(doc.documentId, this.getInitialDocContent());
    
    return doc.documentId;
  }

  getInitialDocContent() {
    return [
      {
        insertText: {
          location: { index: 1 },
          text: `🛡️ SPONSORGUARD AI AGENT - EMAIL TRACKER

Generated automatically by SponsorGuard AI Agent
Last Updated: ${new Date().toLocaleString()}

═══════════════════════════════════════════

📊 DAILY SPONSOR OPPORTUNITIES

This document tracks all potential sponsor emails detected by our AI system.
Each entry includes company details, risk assessment, and verification results.

═══════════════════════════════════════════

`
        }
      }
    ];
  }

  async saveToGoogleDocs(emailData) {
    try {
      console.log('📄 Preparing content for Google Docs...');
      
      const content = this.formatEmailForDoc(emailData);
      
      // Copy to clipboard if possible
      try {
        await navigator.clipboard.writeText(content);
        console.log('📋 Content copied to clipboard!');
      } catch (clipboardError) {
        console.log('⚠️ Could not copy to clipboard, showing content for manual copy');
      }
      
      // Always show the content for manual copy-paste
      console.log('📝 COPY THIS CONTENT TO YOUR GOOGLE DOC:');
      console.log('═════════════════════════════════════════');
      console.log(content);
      console.log('═════════════════════════════════════════');
      console.log('🔗 Your Google Doc: https://docs.google.com/document/d/1fPdI3TvMwjRsCYo7nZdtlGnqq2BCZH1XlYPdEQOFits/edit');
      console.log('💡 The content is ready - copy it from above and paste into your Google Doc!');
      
      // Show notification with instructions
      try {
        chrome.notifications.create({
          type: 'basic',
          iconUrl: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
          title: 'SponsorGuard: Content Ready!',
          message: `Check console to copy sponsor email analysis for "${emailData.originalEmail?.subject}"`
        });
      } catch (error) {
        console.log('📢 Sponsor email analysis ready - check console to copy!');
      }
      
    } catch (error) {
      console.error('❌ Error preparing content:', error);
    }
  }

  formatEmailForDoc(emailData) {
    const email = emailData.originalEmail;
    const extracted = emailData.extractedInfo || {};
    const timestamp = new Date().toLocaleString();

    return `
🎯 NEW SPONSOR OPPORTUNITY DETECTED
═══════════════════════════════════════════

⏰ Detected: ${timestamp}
📧 Subject: ${email?.subject || 'N/A'}
👤 From: ${email?.sender || 'N/A'}

🏢 COMPANY INFORMATION:
• Company Name: ${extracted.companyName || 'Not specified'}
• Website: ${extracted.website || 'Not specified'}  
• Contact Person: ${extracted.contactPerson || 'Not specified'}

💰 OPPORTUNITY DETAILS:
${extracted.offer || 'Please review email for full details'}

🔍 AI VERIFICATION RESULTS:
• Risk Score: ${emailData.riskScore || 'N/A'}/100
• Status: ${emailData.status?.toUpperCase() || 'UNKNOWN'}
• Confidence Level: ${emailData.isSponsor ? 'HIGH' : 'MEDIUM'}

⚠️ SECURITY FLAGS:
${emailData.flags?.map(flag => `• ${flag.message}`).join('\n') || '• No security concerns detected'}

🔗 View Original: ${email?.url || 'Available in Gmail'}

───────────────────────────────────────────

`;
  }

  async appendToDoc(docId, content) {
    const token = await this.getGoogleToken();
    
    // Get current document length
    const getResponse = await fetch(`https://docs.googleapis.com/v1/documents/${docId}`, {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    const doc = await getResponse.json();
    const endIndex = doc.body.content[doc.body.content.length - 1].endIndex - 1;

    // Append new content
    await fetch(`https://docs.googleapis.com/v1/documents/${docId}:batchUpdate`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        requests: [
          {
            insertText: {
              location: { index: endIndex },
              text: content
            }
          }
        ]
      }),
    });
  }

  async updateDocContent(docId, requests) {
    const token = await this.getGoogleToken();
    
    await fetch(`https://docs.googleapis.com/v1/documents/${docId}:batchUpdate`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ requests }),
    });
  }

  async getGoogleDocsUrl() {
    if (!this.googleDocsId) {
      await this.initializeGoogleDocs();
    }
    return `https://docs.google.com/document/d/${this.googleDocsId}/edit`;
  }

  addActivity(activity) {
    this.recentActivities.unshift(activity);
    if (this.recentActivities.length > this.maxActivities) {
      this.recentActivities.pop();
    }

    // Notify popup if it's open
    try {
      chrome.runtime.sendMessage({
        type: 'activity',
        data: activity
      }).catch(() => {}); // Ignore errors if popup not open
    } catch (error) {
      // Popup not open, ignore
    }
  }

  async generateEmailSummary(emailData) {
    try {
      console.log('📝 Generating AI summary for:', emailData.subject);
      
      // Create intelligent summary using our analysis capabilities
      const summary = this.createIntelligentSummary(emailData);
      
      console.log('✅ Generated email summary:', summary);
      return summary;

    } catch (error) {
      console.error('Error generating AI summary:', error);
      // Return fallback summary
      return this.generateFallbackSummary(emailData);
    }
  }

  createIntelligentSummary(emailData) {
    const senderName = emailData.sender.split('@')[0].replace(/[._]/g, ' ');
    const domain = emailData.sender.split('@')[1];
    const body = emailData.body.toLowerCase();
    
    // Determine email type and action
    let emailType = 'Email';
    let action = 'Read and respond';
    
    // Business/Sponsor opportunities
    if (body.includes('sponsor') || body.includes('partnership') || 
        body.includes('collaboration') || body.includes('brand')) {
      emailType = 'Sponsor opportunity';
      
      // Extract money amount if mentioned
      const moneyMatch = emailData.body.match(/\$([0-9,]+)/);
      if (moneyMatch) {
        action = `Offering $${moneyMatch[1]} for partnership`;
      } else {
        action = 'Partnership/collaboration proposal';
      }
    }
    // Meeting/Calendar requests
    else if (body.includes('meeting') || body.includes('call') || 
             body.includes('schedule') || body.includes('calendar')) {
      emailType = 'Meeting request';
      
      // Extract time/date if mentioned
      const timeMatch = emailData.body.match(/(monday|tuesday|wednesday|thursday|friday|saturday|sunday|tomorrow|next week)/i);
      if (timeMatch) {
        action = `Schedule for ${timeMatch[1]}`;
      } else {
        action = 'Check calendar and respond';
      }
    }
    // Urgent/Important items
    else if (body.includes('urgent') || body.includes('important') || 
             body.includes('asap') || body.includes('immediately')) {
      emailType = 'Urgent email';
      action = 'Requires immediate attention';
    }
    // Financial/Payment
    else if (body.includes('payment') || body.includes('invoice') || 
             body.includes('bill') || body.includes('transaction')) {
      emailType = 'Financial email';
      action = 'Review payment details';
    }
    // Follow-up emails
    else if (body.includes('follow up') || body.includes('following up') || 
             body.includes('checking in')) {
      emailType = 'Follow-up';
      action = 'Previous conversation continues';
    }
    // News/Updates
    else if (body.includes('newsletter') || body.includes('update') || 
             body.includes('announcement')) {
      emailType = 'Newsletter/Update';
      action = 'Industry news and updates';
    }
    else {
      // Extract first meaningful sentence as action
      const sentences = emailData.body.split(/[.!?]+/).filter(s => s.trim().length > 15);
      if (sentences.length > 0) {
        action = sentences[0].trim().slice(0, 50) + '...';
      }
    }

    return {
      line1: `${emailType} from ${this.capitalizeWords(senderName)}`,
      line2: action.slice(0, 60),
      type: 'ai-generated',
      domain: domain,
      timestamp: new Date().toISOString()
    };
  }

  generateFallbackSummary(emailData) {
    const senderName = emailData.sender.split('@')[0].replace(/[._]/g, ' ');
    
    return {
      line1: `Email from ${this.capitalizeWords(senderName)}`,
      line2: 'Read and respond as needed',
      type: 'fallback'
    };
  }
}

// Initialize background service
new BackgroundService(); 