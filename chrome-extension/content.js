// Gmail DOM manipulation and sponsor email detection
class SponsorGuardAgent {
  constructor() {
    this.isProcessing = false;
    this.processedEmails = new Set();
    this.sponsorEmails = [];
    this.observer = null;
    this.debugMode = false;
    this.sessionId = Date.now(); // Unique session ID
    this.init();
  }

  async init() {
    console.log('🛡️ SponsorGuard AI Agent initialized');
    await this.loadProcessedEmails();
    this.waitForGmail();
    this.setupMessageListener();
    
    // Enable debug mode by default for testing
    this.debugMode = true;
    console.log('🐛 Debug mode enabled by default');
  }

  setupMessageListener() {
    chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
      if (request.action === 'resetProcessed') {
        this.processedEmails.clear();
        this.saveProcessedEmails();
        this.processExistingEmails();
        sendResponse({ success: true });
      }
    });
  }

  async loadProcessedEmails() {
    try {
      const result = await chrome.storage.local.get([`processedEmails_${this.sessionId}`]);
      const stored = result[`processedEmails_${this.sessionId}`] || [];
      this.processedEmails = new Set(stored);
      console.log(`📚 Loaded ${this.processedEmails.size} processed emails for this session`);
    } catch (error) {
      console.error('Error loading processed emails:', error);
    }
  }

  async saveProcessedEmails() {
    try {
      const emailsArray = Array.from(this.processedEmails);
      await chrome.storage.local.set({
        [`processedEmails_${this.sessionId}`]: emailsArray
      });
    } catch (error) {
      if (error.message.includes('Extension context invalidated')) {
        console.log('⚠️ Extension context invalidated - please reload extension');
        return;
      }
      console.error('Error saving processed emails:', error);
    }
  }

  waitForGmail() {
    // Wait for Gmail to load completely
    const checkGmail = () => {
      if (this.isGmailLoaded()) {
        console.log('📧 Gmail loaded, setting up observer...');
        this.setupObserver();
        setTimeout(() => this.processExistingEmails(), 2000);
      } else {
        setTimeout(checkGmail, 1000);
      }
    };
    checkGmail();
  }

  isGmailLoaded() {
    return document.querySelector('[data-thread-id]') !== null ||
           document.querySelector('.nH') !== null ||
           document.querySelector('[role="main"]') !== null ||
           document.querySelector('.aeN') !== null;
  }

  setupObserver() {
    // Observe Gmail DOM changes for new emails
    this.observer = new MutationObserver((mutations) => {
      if (!this.isProcessing) {
        this.debounceProcessEmails();
      }
    });

    const targetNode = document.querySelector('body');
    if (targetNode) {
      this.observer.observe(targetNode, {
        childList: true,
        subtree: true,
        attributes: false
      });
    }
  }

  debounceProcessEmails() {
    clearTimeout(this.debounceTimer);
    this.debounceTimer = setTimeout(() => {
      this.processNewEmails();
    }, 1000);
  }

  async processExistingEmails() {
    console.log('🔍 Scanning existing emails...');
    const emailElements = this.getEmailElements();
    console.log(`Found ${emailElements.length} email elements`);
    
    for (const element of emailElements) {
      await this.processEmail(element);
      // Small delay to avoid overwhelming the system
      await new Promise(resolve => setTimeout(resolve, 100));
    }
  }

  async processNewEmails() {
    const emailElements = this.getEmailElements();
    const newEmails = emailElements.filter(el => {
      const id = this.getEmailId(el);
      return id && !this.processedEmails.has(id);
    });

    if (newEmails.length > 0) {
      console.log(`📬 Processing ${newEmails.length} new emails...`);
      for (const element of newEmails) {
        await this.processEmail(element);
      }
    }
  }

  getEmailElements() {
    // Multiple selectors for different Gmail views
    const selectors = [
      // Conversation view
      '[data-thread-id]',
      '.ii.gt .a3s.aiL',
      // Inbox list view
      '[role="listitem"] [data-message-id]',
      // Various Gmail containers
      '.nH .if',
      '.gs .gE.iv.gt',
      // Updated Gmail selectors
      '.adn.ads',
      '.aeN .aP3',
      'tr.zA',
      '.cf.zt'
    ];

    let elements = [];
    for (const selector of selectors) {
      const found = document.querySelectorAll(selector);
      elements = elements.concat(Array.from(found));
    }

    // Filter out elements without meaningful content
    return elements.filter(el => {
      const text = el.textContent || el.innerText;
      return text && text.length > 50 && !el.querySelector('.sponsor-guard-label');
    });
  }

  getEmailId(element) {
    // Create more unique ID combining multiple attributes and content hash
    const threadId = element.getAttribute('data-thread-id');
    const messageId = element.getAttribute('data-message-id');
    const legacyId = element.getAttribute('data-legacy-thread-id');
    const elementId = element.id;
    
    // If we have a proper thread/message ID, use it
    if (threadId) return `thread_${threadId}`;
    if (messageId) return `msg_${messageId}`;
    if (legacyId) return `legacy_${legacyId}`;
    if (elementId) return `elem_${elementId}`;
    
    // Fallback: create hash from content + position
    const content = element.textContent || '';
    const position = Array.from(element.parentNode?.children || []).indexOf(element);
    const contentHash = this.simpleHash(content.slice(0, 200));
    
    return `content_${contentHash}_${position}`;
  }

  simpleHash(str) {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash; // Convert to 32-bit integer
    }
    return Math.abs(hash).toString(36);
  }

  async processEmail(element) {
    try {
      const emailId = this.getEmailId(element);
      if (this.processedEmails.has(emailId)) return;

      this.processedEmails.add(emailId);
      await this.saveProcessedEmails(); // Persist immediately
      
      const emailData = this.extractEmailData(element);
      if (!emailData) return;

      if (this.debugMode) {
        console.log('📧 Processing email:', emailData.subject);
      }

      // Quick keyword check first
      if (!this.hasSponsortKeywords(emailData)) {
        if (this.debugMode) {
          console.log('⏭️ Skipping email (no sponsor keywords):', emailData.subject);
        }
        return; // Skip non-sponsor emails early
      }

      console.log('🎯 Found potential sponsor email:', emailData.subject);

      // Send to background script for AI analysis
      const result = await this.sendToAnalysis(emailData);
      
      // Check if we got an error (extension context invalidated)
      if (result.error) {
        console.log('❌ Analysis failed:', result.error);
        // Fallback: just mark as sponsor if has keywords
        const fallbackResult = {
          isSponsor: true,
          riskScore: 30,
          status: 'sponsor',
          extractedInfo: {
            companyName: 'Unknown Company',
            offer: 'Sponsor opportunity detected'
          },
          originalEmail: emailData
        };
        
        this.sponsorEmails.push(fallbackResult);
        this.markAsSponsorEmail(element, fallbackResult);
        console.log('✅ Sponsor email detected (fallback mode):', emailData.subject);
        return;
      }
      
      if (this.isSponsorEmail(result)) {
        this.sponsorEmails.push(result);
        this.markAsSponsorEmail(element, result);
        
        // Send to Google Docs
        await this.sendToGoogleDocs(result);
        
        console.log('✅ Sponsor email detected and saved:', emailData.subject);
      }

    } catch (error) {
      console.error('❌ Error processing email:', error);
    }
  }

  hasSponsortKeywords(emailData) {
    const sponsorKeywords = [
      'sponsor', 'partnership', 'collaboration', 'brand deal',
      'influencer', 'campaign', 'promotion', 'advertising',
      'content creator', 'social media', 'youtube', 'instagram',
      'tiktok', 'brand ambassador', 'affiliate', 'marketing',
      'product placement', 'endorsement', 'paid post', 'review',
      'feature', 'shoutout', 'mention', 'brand', 'company',
      'business', 'opportunity', 'proposal', 'deal', 'offer'
    ];

    const emailText = (emailData.subject + ' ' + emailData.body).toLowerCase();
    const hasKeywords = sponsorKeywords.some(keyword => emailText.includes(keyword));
    
    if (this.debugMode) {
      console.log('🔍 Keyword check for:', emailData.subject, '- Has keywords:', hasKeywords);
      if (hasKeywords) {
        const foundKeywords = sponsorKeywords.filter(keyword => emailText.includes(keyword));
        console.log('📝 Found keywords:', foundKeywords);
      }
    }
    
    return hasKeywords;
  }

  extractEmailData(element) {
    const text = element.textContent || element.innerText;
    if (!text || text.length < 20) return null; // Reduced minimum length

    // Enhanced extraction for different Gmail views
    let subjectElement = element.querySelector('[data-subject]') ||
                        element.querySelector('.bog') ||
                        element.querySelector('.hP') ||
                        element.querySelector('.y6') ||
                        element.querySelector('span[data-thread-id]');
    
    let senderElement = element.querySelector('[email]') ||
                       element.querySelector('.go .g2') ||
                       element.querySelector('.yW span[email]') ||
                       element.querySelector('.yW span[name]') ||
                       element.querySelector('.zF') ||
                       element.querySelector('.yP');

    // Fallback extraction from text content
    let subject = subjectElement?.textContent || 'No Subject';
    let sender = senderElement?.getAttribute('email') || 
                senderElement?.getAttribute('name') ||
                senderElement?.textContent || 'Unknown Sender';

    // Try to extract from text patterns if elements not found
    if (!subjectElement || subject === 'No Subject') {
      // Look for subject patterns in text
      const subjectMatch = text.match(/Subject:\s*(.+?)(?:\n|From:|$)/i) ||
                          text.match(/^(.+?)\n/); // First line as subject
      if (subjectMatch) subject = subjectMatch[1].trim();
    }

    if (!senderElement || sender === 'Unknown Sender') {
      const emailMatch = text.match(/([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/);
      if (emailMatch) sender = emailMatch[1];
    }

    // If still no subject, use first part of text
    if (subject === 'No Subject') {
      subject = text.split('\n')[0].slice(0, 50) + '...';
    }

    const emailData = {
      id: this.getEmailId(element),
      subject: subject.slice(0, 200), // Limit length
      sender: sender.slice(0, 100),   // Limit length
      body: text.slice(0, 5000),      // Limit body length for API
      timestamp: new Date().toISOString(),
      url: window.location.href,
      element: element // Keep reference for UI updates
    };

    if (this.debugMode) {
      console.log('📧 Extracted email data:', {
        subject: emailData.subject,
        sender: emailData.sender,
        bodyLength: emailData.body.length
      });
    }

    return emailData;
  }

  async sendToAnalysis(emailData) {
    return new Promise((resolve) => {
      // Remove element reference before sending to avoid circular refs
      const { element, ...dataToSend } = emailData;
      
      try {
        chrome.runtime.sendMessage({
          action: 'analyzeEmail',
          data: dataToSend
        }, (response) => {
          if (chrome.runtime.lastError) {
            console.error('Runtime error:', chrome.runtime.lastError.message);
            resolve({ error: chrome.runtime.lastError.message });
            return;
          }
          resolve(response || {});
        });
      } catch (error) {
        console.error('Error sending to analysis:', error);
        resolve({ error: error.message });
      }
    });
  }

  isSponsorEmail(result) {
    // Check multiple indicators for sponsor emails
    return result.isSponsor ||
           result.extractedInfo?.companyName ||
           result.extractedInfo?.offer ||
           (result.riskScore && result.riskScore < 50) || // Low risk = good sponsor
           result.flags?.some(flag => flag.type === 'green');
  }

  markAsSponsorEmail(element, result) {
    // Avoid duplicate labels
    if (element.querySelector('.sponsor-guard-label')) return;

    const label = document.createElement('div');
    label.className = 'sponsor-guard-label sponsor-guard-new';
    label.style.cssText = `
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      color: white;
      padding: 6px 12px;
      border-radius: 16px;
      font-size: 11px;
      font-weight: 600;
      margin: 6px 0;
      display: inline-block;
      box-shadow: 0 3px 6px rgba(0,0,0,0.15);
      z-index: 1000;
      position: relative;
      animation: sponsorPulse 2s ease-in-out 3;
    `;
    
    // Different labels based on confidence
    const confidence = result.riskScore < 30 ? 'HIGH' : 
                      result.riskScore < 50 ? 'MEDIUM' : 'LOW';
    
    label.innerHTML = `💼 SPONSOR DETECTED (${confidence} CONFIDENCE)`;

    // Insert at the beginning of email
    element.insertBefore(label, element.firstChild);

    // Add highlight to entire email element
    element.style.borderLeft = '4px solid #667eea';
    element.style.background = 'linear-gradient(90deg, rgba(102, 126, 234, 0.05) 0%, transparent 100%)';
  }

  async sendToGoogleDocs(emailData) {
    try {
      chrome.runtime.sendMessage({
        action: 'saveToGoogleDocs',
        data: emailData
      }, (response) => {
        if (chrome.runtime.lastError) {
          console.error('Google Docs error:', chrome.runtime.lastError.message);
        }
      });
    } catch (error) {
      console.error('Error sending to Google Docs:', error);
    }
  }

  // Public method to enable debug mode
  enableDebug() {
    this.debugMode = true;
    console.log('🐛 Debug mode enabled');
  }

  // Public method to get stats
  getStats() {
    return {
      processedEmails: this.processedEmails.size,
      sponsorEmails: this.sponsorEmails.length,
      isProcessing: this.isProcessing
    };
  }

  // Public method to manually trigger scan
  rescanEmails() {
    this.processedEmails.clear();
    this.processExistingEmails();
  }
}

// Initialize when DOM is ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => {
    window.sponsorGuard = new SponsorGuardAgent();
  });
} else {
  window.sponsorGuard = new SponsorGuardAgent();
}

// Make methods available globally for debugging
window.sponsorGuardDebug = () => {
  if (window.sponsorGuard) {
    window.sponsorGuard.enableDebug();
    console.log('SponsorGuard Stats:', window.sponsorGuard.getStats());
  }
};

window.sponsorGuardRescan = () => {
  if (window.sponsorGuard) {
    window.sponsorGuard.rescanEmails();
  }
};

// Test function to manually create a sponsor email for testing
window.sponsorGuardTest = () => {
  if (window.sponsorGuard) {
    console.log('🧪 Creating test sponsor email...');
    
    // Create a fake email element for testing
    const testEmail = document.createElement('div');
    testEmail.innerHTML = `
      <div>From: marketing@testcompany.com</div>
      <div>Subject: Brand Partnership Opportunity</div>
      <div>Hi! We'd love to partner with you for a sponsored post about our new product. 
      We're a growing company looking for influencers to promote our brand. 
      This is a great business opportunity for collaboration.</div>
    `;
    testEmail.style.cssText = 'border: 2px dashed #ccc; padding: 10px; margin: 10px; background: #f9f9f9;';
    
    // Insert test email at top of page
    document.body.insertBefore(testEmail, document.body.firstChild);
    
    // Process the test email
    window.sponsorGuard.processEmail(testEmail);
    
    console.log('✅ Test email created and processed');
  }
}; 