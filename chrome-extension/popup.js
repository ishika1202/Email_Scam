// Popup interface controller for SponsorGuard
class PopupController {
  constructor() {
    this.activities = [];
    this.maxActivities = 10;
    this.initializeElements();
    this.setupEventListeners();
    this.checkApiStatus();
    this.analyzeCurrentEmail(); // Automatically analyze current email
  }

  initializeElements() {
    this.status = document.getElementById('status');
    this.loading = document.getElementById('loading');
    this.apiStatusDot = document.getElementById('apiStatusDot');
    this.apiStatusText = document.getElementById('apiStatusText');
    this.checklistContainer = document.getElementById('checklistContainer');
    
    this.refreshBtn = document.getElementById('refreshBtn');
    this.debugBtn = document.getElementById('debugBtn');
    
    // Verification row elements
    this.domainCheck = document.getElementById('domainCheck');
    this.websiteCheck = document.getElementById('websiteCheck');
    this.contactCheck = document.getElementById('contactCheck');
    this.phoneCheck = document.getElementById('phoneCheck');
    this.linkedinCheck = document.getElementById('linkedinCheck');
    this.riskCheck = document.getElementById('riskCheck');
  }

  setupEventListeners() {
    this.refreshBtn.addEventListener('click', () => this.refreshAnalysis());
    this.debugBtn.addEventListener('click', () => this.toggleDebugMode());

    // Listen for activity updates and verification results from background script
    chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
      try {
        if (message && message.type === 'verificationResult') {
          this.displayVerificationResult(message.data);
        } else if (message && message.type === 'sponsorDetected') {
          this.displaySponsorInfo(message.data);
        }
        sendResponse({ received: true });
      } catch (error) {
        console.error('Message handling error:', error);
        sendResponse({ error: error.message });
      }
    });
  }

  async checkApiStatus() {
    try {
      const response = await fetch('http://localhost:3000/api/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ emailContent: 'test' })
      });
      
      if (response.status === 200 || response.status === 400) {
        this.updateApiStatus(true, 'AI Analysis API Online');
      } else {
        this.updateApiStatus(false, 'API Error');
      }
    } catch (error) {
      this.updateApiStatus(false, 'AI Analysis API Offline');
    }
  }

  updateApiStatus(online, text) {
    this.apiStatusDot.className = `status-dot ${online ? 'online' : ''}`;
    this.apiStatusText.textContent = text;
  }

  async analyzeCurrentEmail() {
    try {
      this.showLoading(true);
      this.updateStatus('Analyzing current email...');
      
      // Get active Gmail tab
      const [tab] = await chrome.tabs.query({
        active: true,
        url: ["*://mail.google.com/*", "*://gmail.com/*"]
      });
      
      if (!tab) {
        this.updateStatus('Please open Gmail to analyze emails', 'error');
        this.showLoading(false);
        return;
      }

      // Get current email content from the page
      const results = await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        func: () => {
                     // Extract current email content
           const getCurrentEmailContent = () => {
             // Try different selectors for current email (updated for modern Gmail)
             const selectors = [
               // Modern Gmail selectors
               '[data-message-id] .a3s.aiL',
               '.ii.gt .a3s.aiL',
               '.adn.ads .a3s.aiL',
               '[role="listitem"] .a3s.aiL',
               '.nH .if .ii.gt .a3s.aiL',
               '.gs .gE.iv.gt .a3s',
               // Fallback selectors
               '.a3s.aiL',
               '.ii.gt',
               '.adn.ads',
               '[data-thread-id]',
               '.nH .if',
               // Even broader selectors
               '[role="main"] div[data-message-id]',
               '[jsaction*="click"] .a3s',
               '.zA.yO', // List view
               '.cf.zt' // Another list view
             ];
             
             let emailElement = null;
             let emailText = '';
             
             // Try each selector
             for (const selector of selectors) {
               const elements = document.querySelectorAll(selector);
               console.log(`Trying selector: ${selector}, found ${elements.length} elements`);
               
               if (elements.length > 0) {
                 // Get the element with the most text content
                 emailElement = Array.from(elements).reduce((best, current) => {
                   const currentText = current.textContent || current.innerText || '';
                   const bestText = best ? (best.textContent || best.innerText || '') : '';
                   return currentText.length > bestText.length ? current : best;
                 }, null);
                 
                 if (emailElement) {
                   emailText = emailElement.textContent || emailElement.innerText || '';
                   if (emailText.length > 50) break; // Found meaningful content
                 }
               }
             }
             
             // If still no content, try to get any visible text from the page
             if (!emailText || emailText.length < 50) {
               console.log('Trying fallback text extraction...');
               const fallbackSelectors = [
                 '[role="main"]',
                 '.nH',
                 'body'
               ];
               
               for (const selector of fallbackSelectors) {
                 const element = document.querySelector(selector);
                 if (element) {
                   const text = element.textContent || element.innerText || '';
                   // Look for email-like content
                   if (text.includes('@') || text.includes('Subject:') || text.includes('From:')) {
                     emailText = text;
                     emailElement = element;
                     break;
                   }
                 }
               }
             }
             
             if (!emailText || emailText.length < 20) {
               return { 
                 error: 'No email content found', 
                 debug: {
                   url: window.location.href,
                   selectors: selectors.map(s => ({
                     selector: s,
                     count: document.querySelectorAll(s).length
                   }))
                 }
               };
             }
            
                         // Use the extracted email text
             const text = emailText;
             
             // Try to get subject with more selectors
             let subject = 'No Subject';
             const subjectSelectors = [
               '.hP', // Classic Gmail
               '[data-subject]',
               '.bog',
               '.aYF', // New Gmail
               '.y6', // Another Gmail selector
               'h2[data-thread-id]',
               '[role="heading"]'
             ];
             
             for (const selector of subjectSelectors) {
               const element = document.querySelector(selector);
               if (element) {
                 subject = element.textContent || element.getAttribute('data-subject') || subject;
                 if (subject !== 'No Subject') break;
               }
             }
             
             // Try to extract subject from text if not found
             if (subject === 'No Subject') {
               const subjectMatch = text.match(/Subject:\s*(.+?)(?:\n|$)/i);
               if (subjectMatch) {
                 subject = subjectMatch[1].trim();
               } else {
                 // Use first meaningful line as subject
                 const lines = text.split('\n').filter(line => line.trim().length > 5);
                 if (lines.length > 0) {
                   subject = lines[0].slice(0, 100);
                 }
               }
             }
             
             // Try to get sender with more selectors
             let sender = 'Unknown Sender';
             const senderSelectors = [
               '.go .g2',
               '[email]',
               '.yW span[email]',
               '.yW span[name]',
               '.zF',
               '.yP',
               '.gD', // Gmail sender
               '.qu .go span'
             ];
             
             for (const selector of senderSelectors) {
               const element = document.querySelector(selector);
               if (element) {
                 sender = element.getAttribute('email') || 
                         element.getAttribute('name') ||
                         element.textContent || sender;
                 if (sender !== 'Unknown Sender') break;
               }
             }
             
             // Try to extract sender from text
             if (sender === 'Unknown Sender') {
               const emailMatch = text.match(/([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/);
               if (emailMatch) {
                 sender = emailMatch[1];
               } else {
                 const fromMatch = text.match(/From:\s*(.+?)(?:\n|<)/i);
                 if (fromMatch) {
                   sender = fromMatch[1].trim();
                 }
               }
             }
             
             console.log('Extracted email data:', {
               subject: subject.slice(0, 50),
               sender: sender.slice(0, 50),
               bodyLength: text.length,
               url: window.location.href
             });
             
             return {
               subject: subject.slice(0, 200),
               sender: sender.slice(0, 100),
               body: text.slice(0, 5000),
               url: window.location.href
             };
          };
          
          return getCurrentEmailContent();
        }
      });
      
      const emailData = results[0]?.result;
      
      if (!emailData || emailData.error) {
        this.updateStatus(emailData?.error || 'Could not extract email content', 'error');
        this.showLoading(false);
        return;
      }
      
      if (!emailData.body || emailData.body.length < 20) {
        this.updateStatus('No meaningful email content found', 'error');
        this.showLoading(false);
        return;
      }
      
             // Send to API for analysis
       this.updateStatus('Sending to AI for analysis...');
       
       const response = await fetch('http://localhost:3000/api/verify', {
         method: 'POST',
         headers: { 'Content-Type': 'application/json' },
         body: JSON.stringify({ emailContent: emailData.body })
       });
      
      if (!response.ok) {
        throw new Error(`API error: ${response.status}`);
      }
      
      const verificationResult = await response.json();
      
      // Display results
      this.displayVerificationResult(verificationResult);
      this.updateStatus('Email analysis complete', 'success');
      
    } catch (error) {
      this.updateStatus('Error analyzing email', 'error');
      console.error('Analysis error:', error);
    } finally {
      this.showLoading(false);
    }
  }

  async refreshAnalysis() {
    // Just call analyzeCurrentEmail again
    await this.analyzeCurrentEmail();
  }

  async toggleDebugMode() {
    try {
      // Get active Gmail tab
      const [tab] = await chrome.tabs.query({
        active: true,
        url: ["*://mail.google.com/*", "*://gmail.com/*"]
      });
      
      if (tab) {
        // Inject debug commands
        await chrome.scripting.executeScript({
          target: { tabId: tab.id },
          func: () => {
            if (window.sponsorGuardDebug) {
              window.sponsorGuardDebug();
            }
          }
        });
        
        this.updateStatus('Debug mode enabled - check Gmail console', 'success');
      } else {
        this.updateStatus('Please open Gmail to enable debug mode', 'error');
      }
    } catch (error) {
      this.updateStatus('Error enabling debug mode', 'error');
      console.error('Debug error:', error);
    }
  }

  showLoading(show) {
    this.loading.style.display = show ? 'block' : 'none';
  }

  updateStatus(message, type = '') {
    this.status.textContent = message;
    this.status.className = `status ${type}`;
    
    // Auto-clear status after 4 seconds
    setTimeout(() => {
      if (this.status.textContent === message) {
        this.status.textContent = 'Ready to detect sponsor emails';
        this.status.className = 'status';
      }
    }, 4000);
  }

  displayVerificationResult(data) {
    // Extract domains from flags
    const domains = this.extractDomainsFromFlags(data.flags);
    const phones = this.extractPhonesFromFlags(data.flags);
    const linkedinInfo = this.extractLinkedInFromFlags(data.flags);
    
    // Update domain verification
    const domainStatus = this.getDomainStatus(data.flags);
    this.updateVerificationRow(this.domainCheck, {
      status: domainStatus.status,
      icon: domainStatus.icon,
      value: domains.length > 0 ? domains[0] : (data.extractedInfo?.website || 'Not found')
    });
    
    // Update website status
    const websiteStatus = this.getWebsiteStatus(data.flags);
    this.updateVerificationRow(this.websiteCheck, {
      status: websiteStatus.status,
      icon: websiteStatus.icon,
      value: websiteStatus.message
    });
    
    // Update contact verification
    this.updateVerificationRow(this.contactCheck, {
      status: data.extractedInfo?.contactPerson ? 'passed' : 'warning',
      icon: data.extractedInfo?.contactPerson ? '✅' : '⚠️',
      value: data.extractedInfo?.contactPerson || 'Not specified'
    });
    
    // Update phone verification
    this.updateVerificationRow(this.phoneCheck, {
      status: phones.length > 0 ? 'passed' : 'warning',
      icon: phones.length > 0 ? '✅' : '⚠️',
      value: phones.length > 0 ? phones[0] : 'Not found'
    });
    
    // Update LinkedIn verification
    this.updateVerificationRow(this.linkedinCheck, {
      status: linkedinInfo.status,
      icon: linkedinInfo.icon,
      value: linkedinInfo.message
    });
    
    // Update risk score
    const riskStatus = data.riskScore > 70 ? 'failed' : data.riskScore > 40 ? 'warning' : 'passed';
    const riskIcon = data.riskScore > 70 ? '❌' : data.riskScore > 40 ? '⚠️' : '✅';
    this.updateVerificationRow(this.riskCheck, {
      status: riskStatus,
      icon: riskIcon,
      value: `${data.riskScore}/100 (${this.getRiskLevel(data.riskScore)})`
    });
  }

  resetChecklist() {
    const items = [this.domainCheck, this.websiteCheck, this.contactCheck, this.securityCheck, this.sponsorCheck];
    items.forEach(item => {
      item.className = 'checklist-item';
      const icon = item.querySelector('.check-icon');
      const status = item.querySelector('.check-status');
      icon.textContent = '⏳';
      status.textContent = 'Checking...';
    });
  }

  updateChecklistItem(element, { status, icon, message }) {
    element.className = `checklist-item ${status}`;
    element.querySelector('.check-icon').textContent = icon;
    element.querySelector('.check-status').textContent = message;
  }

  getRiskLevel(score) {
    if (score > 70) return 'HIGH RISK';
    if (score > 40) return 'MEDIUM RISK';
    return 'LOW RISK';
  }

  addChecklistSummary(data) {
    // Remove existing summary
    const existingSummary = this.checklistContainer.querySelector('.checklist-summary');
    if (existingSummary) existingSummary.remove();
    
    // Create new summary
    const summary = document.createElement('div');
    summary.className = 'checklist-summary';
    
    const scoreClass = data.riskScore > 70 ? 'danger' : data.riskScore > 40 ? 'warning' : 'safe';
    const recommendation = data.riskScore > 70 ? 'NOT RECOMMENDED' : 
                          data.riskScore > 40 ? 'PROCEED WITH CAUTION' : 
                          'SAFE TO PROCEED';
    
    summary.innerHTML = `
      <div class="summary-score ${scoreClass}">${recommendation}</div>
      <div>Overall Risk: ${data.riskScore}/100</div>
    `;
    
    this.checklistContainer.appendChild(summary);
  }

  displaySponsorInfo(data) {
    // Handle sponsor detection info display
    console.log('Sponsor info received:', data);
  }

  updateVerificationRow(element, { status, icon, value }) {
    if (element) {
      element.className = `verification-row ${status}`;
      const iconEl = element.querySelector('.status-icon');
      const valueEl = element.querySelector('.item-value');
      if (iconEl) iconEl.textContent = icon;
      if (valueEl) valueEl.textContent = value;
    }
  }

  extractDomainsFromFlags(flags) {
    const domains = [];
    flags.forEach(flag => {
      const domainMatch = flag.message.match(/Domain (\S+)/);
      if (domainMatch) {
        domains.push(domainMatch[1]);
      }
    });
    return [...new Set(domains)]; // Remove duplicates
  }

  extractPhonesFromFlags(flags) {
    const phones = [];
    flags.forEach(flag => {
      if (flag.message.includes('phone') || flag.message.includes('Phone')) {
        const phoneMatch = flag.message.match(/(\+?[\d\s\-\(\)]+)/);
        if (phoneMatch && phoneMatch[1].length > 5) {
          phones.push(phoneMatch[1].trim());
        }
      }
    });
    return [...new Set(phones)];
  }

  extractLinkedInFromFlags(flags) {
    const linkedinFlags = flags.filter(flag => 
      flag.message.toLowerCase().includes('linkedin') || 
      flag.message.toLowerCase().includes('profile')
    );
    
    if (linkedinFlags.length === 0) {
      return { status: 'warning', icon: '⚠️', message: 'Not checked' };
    }
    
    const hasGreen = linkedinFlags.some(flag => flag.type === 'green');
    const hasRed = linkedinFlags.some(flag => flag.type === 'red');
    
    if (hasGreen) {
      return { status: 'passed', icon: '✅', message: 'Profile verified' };
    } else if (hasRed) {
      return { status: 'failed', icon: '❌', message: 'Profile not found' };
    } else {
      return { status: 'warning', icon: '⚠️', message: 'Needs verification' };
    }
  }

  getDomainStatus(flags) {
    const domainFlags = flags.filter(flag => 
      flag.message.toLowerCase().includes('domain') && 
      !flag.message.toLowerCase().includes('temporary')
    );
    
    if (domainFlags.length === 0) {
      return { status: 'warning', icon: '⚠️' };
    }
    
    const hasGreen = domainFlags.some(flag => flag.type === 'green');
    const hasRed = domainFlags.some(flag => flag.type === 'red');
    
    if (hasGreen) {
      return { status: 'passed', icon: '✅' };
    } else if (hasRed) {
      return { status: 'failed', icon: '❌' };
    } else {
      return { status: 'warning', icon: '⚠️' };
    }
  }

  getWebsiteStatus(flags) {
    const websiteFlags = flags.filter(flag => 
      flag.message.toLowerCase().includes('website') || 
      flag.message.toLowerCase().includes('url') ||
      flag.message.toLowerCase().includes('live')
    );
    
    if (websiteFlags.length === 0) {
      return { status: 'warning', icon: '⚠️', message: 'Not checked' };
    }
    
    const hasGreen = websiteFlags.some(flag => flag.type === 'green');
    const hasRed = websiteFlags.some(flag => flag.type === 'red');
    
    if (hasGreen) {
      return { status: 'passed', icon: '✅', message: 'Accessible' };
    } else if (hasRed) {
      return { status: 'failed', icon: '❌', message: 'Not accessible' };
    } else {
      return { status: 'warning', icon: '⚠️', message: 'Needs verification' };
    }
  }

}

// Initialize popup when DOM is loaded
document.addEventListener('DOMContentLoaded', () => {
  new PopupController();
}); 