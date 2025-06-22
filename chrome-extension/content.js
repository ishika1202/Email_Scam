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

      // Only generate summaries for emails that are currently open/visible
      if (this.isEmailCurrentlyOpen(element)) {
        const summary = await this.generateEmailSummary(emailData);
        await this.saveEmailSummary(emailData, summary);
        console.log('📝 Summary saved for current email:', emailData.subject);
      }

      // Quick keyword check for sponsor detection
      if (!this.hasSponsortKeywords(emailData)) {
        if (this.debugMode) {
          console.log('⏭️ Email processed, no sponsor keywords:', emailData.subject);
        }
        return; // Skip sponsor analysis
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
        
        // Extract sponsor details for saving
        const sponsorData = this.extractSponsorDetails(result, emailData);
        
        // Send to popup for local storage
        this.sendToPopupStorage(sponsorData);
        
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

  extractSponsorDetails(result, emailData) {
    // Extract company name
    let companyName = result.extractedInfo?.companyName || 
                     this.extractCompanyFromEmail(emailData) || 
                     'Unknown Company';

    // Extract website/domain
    let website = result.extractedInfo?.website || 
                 this.extractWebsiteFromEmail(emailData) || 
                 'Not provided';

    // Extract 2-liner agenda
    let agenda = result.extractedInfo?.offer || 
                result.extractedInfo?.agenda ||
                this.extractAgendaFromEmail(emailData) || 
                'Sponsorship opportunity';

    // Get risk score
    let riskScore = result.riskScore || 0;

    // Extract contact person
    let contactPerson = result.extractedInfo?.contactPerson || 
                       this.extractContactFromEmail(emailData) || 
                       emailData.sender || 
                       'Not specified';

    // Extract money offered
    let moneyOffered = this.extractMoneyFromEmail(emailData) || 'Not specified';

    return {
      companyName,
      website,
      agenda: this.limitText(agenda, 120), // 2-liner limit
      riskScore,
      contactPerson,
      moneyOffered,
      emailSubject: emailData.subject,
      timestamp: emailData.timestamp,
      extractedInfo: result.extractedInfo || {}
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
        if (this.hasSponsortKeywords({ subject: '', body: cleaned })) {
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

  capitalizeWords(str) {
    return str.split(' ').map(word => 
      word.charAt(0).toUpperCase() + word.slice(1).toLowerCase()
    ).join(' ');
  }

  limitText(text, maxLength) {
    if (text.length <= maxLength) return text;
    return text.slice(0, maxLength - 3) + '...';
  }

  sendToPopupStorage(sponsorData) {
    try {
      chrome.runtime.sendMessage({
        type: 'sponsorDetected',
        data: sponsorData
      }, (response) => {
        if (chrome.runtime.lastError) {
          console.error('Error sending to popup storage:', chrome.runtime.lastError.message);
        } else {
          console.log('📦 Sponsor data sent to popup storage:', sponsorData.companyName);
        }
      });
    } catch (error) {
      console.error('Error sending sponsor data to popup:', error);
    }
  }

  async generateEmailSummary(emailData) {
    try {
      // Send email content to background for AI summarization
      const response = await new Promise((resolve) => {
        chrome.runtime.sendMessage({
          action: 'generateSummary',
          data: {
            subject: emailData.subject,
            sender: emailData.sender,
            body: emailData.body.slice(0, 2000) // Limit body for API efficiency
          }
        }, (response) => {
          if (chrome.runtime.lastError) {
            console.error('Summary generation error:', chrome.runtime.lastError.message);
            resolve({ error: chrome.runtime.lastError.message });
            return;
          }
          resolve(response || {});
        });
      });

      if (response.error || !response.summary) {
        // Fallback to simple text-based summary
        return this.generateFallbackSummary(emailData);
      }

      return response.summary;
    } catch (error) {
      console.error('Error generating summary:', error);
      return this.generateFallbackSummary(emailData);
    }
  }

  generateFallbackSummary(emailData) {
    // Simple fallback summary without AI
    const body = emailData.body.toLowerCase();
    let category = 'Email';
    let action = '';

    // Detect email type
    if (body.includes('sponsor') || body.includes('partnership') || body.includes('collaboration')) {
      category = 'Sponsor Opportunity';
      action = 'Review and respond if interested';
    } else if (body.includes('meeting') || body.includes('call') || body.includes('schedule')) {
      category = 'Meeting Request';
      action = 'Check calendar and respond';
    } else if (body.includes('invoice') || body.includes('payment') || body.includes('bill')) {
      category = 'Financial';
      action = 'Review payment details';
    } else if (body.includes('urgent') || body.includes('important') || body.includes('asap')) {
      category = 'Urgent';
      action = 'Requires immediate attention';
    } else {
      // Extract first meaningful sentence
      const sentences = emailData.body.split(/[.!?]+/).filter(s => s.trim().length > 10);
      if (sentences.length > 0) {
        action = sentences[0].trim().slice(0, 80) + '...';
      } else {
        action = 'Read and respond as needed';
      }
    }

    return {
      line1: `${category} from ${emailData.sender.split('@')[0]}`,
      line2: action,
      type: 'fallback'
    };
  }

  async saveEmailSummary(emailData, summary) {
    try {
      const summaryData = {
        id: emailData.id,
        subject: emailData.subject,
        sender: emailData.sender,
        timestamp: emailData.timestamp,
        summary: summary,
        url: emailData.url
      };

      // Get existing summaries
      const result = await chrome.storage.local.get(['emailSummaries']);
      const summaries = result.emailSummaries || [];

      // Remove existing summary for this email if any
      const filteredSummaries = summaries.filter(s => s.id !== emailData.id);

      // Add new summary
      filteredSummaries.unshift(summaryData);

      // Keep only last 100 summaries
      const limitedSummaries = filteredSummaries.slice(0, 100);

      // Save back to storage
      await chrome.storage.local.set({ emailSummaries: limitedSummaries });

      if (this.debugMode) {
        console.log('💾 Email summary saved:', {
          subject: emailData.subject,
          summary: summary
        });
      }

    } catch (error) {
      console.error('Error saving email summary:', error);
    }
  }

  async getEmailSummaries() {
    try {
      const result = await chrome.storage.local.get(['emailSummaries']);
      return result.emailSummaries || [];
    } catch (error) {
      console.error('Error getting email summaries:', error);
      return [];
    }
  }

  async clearEmailSummaries() {
    try {
      await chrome.storage.local.remove(['emailSummaries']);
      console.log('🗑️ Email summaries cleared');
    } catch (error) {
      console.error('Error clearing summaries:', error);
    }
  }

  isEmailCurrentlyOpen(element) {
    // Check if this email is currently being viewed (not just in the list)
    
    // Method 1: Check if element is in the main content area (not list view)
    const isInMainContent = element.closest('.nH.aHU') || // Main content area
                           element.closest('.ii.gt') || // Individual email thread
                           element.closest('.adn.ads'); // Another content area
    
    // Method 2: Check if element is visible and has significant height (not collapsed)
    const rect = element.getBoundingClientRect();
    const isVisible = rect.height > 100 && rect.width > 200;
    
    // Method 3: Check if it's the currently focused/active email
    const isActive = element.classList.contains('h7') || // Gmail active class
                    element.hasAttribute('aria-expanded') ||
                    element.closest('[aria-expanded="true"]');
    
    // Method 4: Check if it's in conversation view (not list view)
    const isInConversation = !element.closest('.zA') && // Not in list row
                            !element.closest('.yW'); // Not in compact view
    
    // Must meet multiple criteria to be considered "currently open"
    const isCurrentlyOpen = isInMainContent && isVisible && (isActive || isInConversation);
    
    if (this.debugMode && isCurrentlyOpen) {
      console.log('📖 Email is currently open, will generate summary:', element);
    }
    
    return isCurrentlyOpen;
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
    console.log('🐛 SponsorGuard Debug Mode Activated');
    console.log('📊 Current stats:', window.sponsorGuard.getStats());
    console.log('📝 Available debug commands:');
    console.log('  - window.sponsorGuard.getEmailSummaries() - View all summaries');
    console.log('  - window.sponsorGuard.clearEmailSummaries() - Clear all summaries');
    console.log('  - sponsorGuardSummarize() - Summarize current email');
    console.log('  - sponsorGuardTest() - Create test email');
    console.log('  - sponsorGuardRescan() - Rescan all emails');
    console.log('  - Click "📝 Email Notes" button in popup to view summaries UI');
  }
};

// Manual summary trigger for current email
window.sponsorGuardSummarize = async () => {
  if (window.sponsorGuard) {
    console.log('📝 Manually generating summary for current email...');
    
    // Find the currently open email
    const selectors = [
      '.ii.gt .a3s.aiL', // Main email content
      '.adn.ads .a3s.aiL', // Another content selector  
      '[role="listitem"] .a3s.aiL' // Alternative selector
    ];
    
    let currentEmailElement = null;
    for (const selector of selectors) {
      const elements = document.querySelectorAll(selector);
      for (const element of elements) {
        if (window.sponsorGuard.isEmailCurrentlyOpen(element)) {
          currentEmailElement = element;
          break;
        }
      }
      if (currentEmailElement) break;
    }
    
    if (currentEmailElement) {
      const emailData = window.sponsorGuard.extractEmailData(currentEmailElement);
      if (emailData) {
        const summary = await window.sponsorGuard.generateEmailSummary(emailData);
        await window.sponsorGuard.saveEmailSummary(emailData, summary);
        console.log('✅ Summary generated:', summary);
        console.log('📧 For email:', emailData.subject);
        return summary;
      }
    }
    
    console.log('❌ No current email found to summarize');
    return null;
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
      This is a great business opportunity for collaboration. We offer $500 per post.</div>
    `;
    testEmail.style.cssText = 'border: 2px dashed #ccc; padding: 10px; margin: 10px; background: #f9f9f9;';
    
    // Insert test email at top of page
    document.body.insertBefore(testEmail, document.body.firstChild);
    
    // Manually mark as sponsor for testing
    const testResult = {
      isSponsor: true,
      riskScore: 25,
      extractedInfo: {
        companyName: 'Test Company',
        offer: 'Brand partnership opportunity'
      }
    };
    
    window.sponsorGuard.markAsSponsorEmail(testEmail, testResult);
    
    console.log('✅ Test sponsor email created with purple box!');
    
    // Also test the extraction
    const emailData = {
      subject: 'Brand Partnership Opportunity',
      sender: 'marketing@testcompany.com',
      body: 'Hi! We\'d love to partner with you for a sponsored post about our new product. We\'re a growing company looking for influencers to promote our brand. This is a great business opportunity for collaboration. We offer $500 per post.'
    };
    
    const extractedData = window.sponsorGuard.extractSponsorDetails(testResult, emailData);
    console.log('📧 Extracted sponsor data:', extractedData);
    
    return testEmail;
  } else {
    console.error('❌ SponsorGuard not found - extension may not be loaded');
  }
}; 