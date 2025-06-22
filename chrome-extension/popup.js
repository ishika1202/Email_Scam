// Popup interface controller for SponsorGuard
class PopupController {
  constructor() {
    this.activities = [];
    this.maxActivities = 10;
    this.initializeElements();
    this.setupEventListeners();
    this.checkApiStatus();
  }

  initializeElements() {
    this.status = document.getElementById('status');
    this.loading = document.getElementById('loading');
    this.apiStatusDot = document.getElementById('apiStatusDot');
    this.apiStatusText = document.getElementById('apiStatusText');
    this.activityList = document.getElementById('activityList');
    
    this.openDocsBtn = document.getElementById('openDocsBtn');
    this.refreshBtn = document.getElementById('refreshBtn');
    this.debugBtn = document.getElementById('debugBtn');
    this.settingsBtn = document.getElementById('settingsBtn');
  }

  setupEventListeners() {
    this.openDocsBtn.addEventListener('click', () => this.openGoogleDocs());
    this.refreshBtn.addEventListener('click', () => this.refreshAnalysis());
    this.debugBtn.addEventListener('click', () => this.toggleDebugMode());
    this.settingsBtn.addEventListener('click', () => this.openSettings());

    // Listen for activity updates and verification results from background script
    chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
      try {
        if (message && message.type === 'activity') {
          this.addActivity(message.data);
        } else if (message && message.type === 'verificationResult') {
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



  async openGoogleDocs() {
    try {
      this.showLoading(true);
      this.updateStatus('Opening Google Docs tracker...');
      
      const response = await chrome.runtime.sendMessage({
        action: 'getGoogleDocsUrl'
      });
      
      if (chrome.runtime.lastError) {
        throw new Error(chrome.runtime.lastError.message);
      }
      
      if (response && response.url) {
        chrome.tabs.create({ url: response.url });
        this.updateStatus('Google Docs opened successfully', 'success');
      } else {
        this.updateStatus('Error: Could not get Google Docs URL', 'error');
      }
    } catch (error) {
      this.updateStatus('Error opening Google Docs', 'error');
      console.error('Google Docs error:', error);
    } finally {
      this.showLoading(false);
    }
  }

  async refreshAnalysis() {
    try {
      this.showLoading(true);
      this.updateStatus('Refreshing email analysis...');
      
      // Get active Gmail tab
      const [tab] = await chrome.tabs.query({
        active: true,
        url: ["*://mail.google.com/*", "*://gmail.com/*"]
      });
      
      if (tab) {
        // Send refresh message to background
        const response = await chrome.runtime.sendMessage({ action: 'refresh' });
        
        if (chrome.runtime.lastError) {
          throw new Error(chrome.runtime.lastError.message);
        }
        
        this.updateStatus('Analysis refreshed successfully', 'success');
      } else {
        this.updateStatus('Please open Gmail to refresh analysis', 'error');
      }
    } catch (error) {
      this.updateStatus('Error refreshing analysis', 'error');
      console.error('Refresh error:', error);
    } finally {
      this.showLoading(false);
    }
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

  openSettings() {
    // Show extension settings and API configuration
    const settingsInfo = `
📋 EXTENSION SETTINGS:

🔧 Configuration Options:
• API Endpoint: ${chrome.runtime.getManifest().host_permissions}
• Auto-scan: Enabled
• Notifications: Enabled
• Google Docs Integration: Available

⚙️ Advanced Settings:
• Risk Threshold: Medium (50+)
• Verification APIs: All enabled
• LinkedIn Verification: SerpApi
• Domain Checks: WhoisXML API

🔄 Reset Options:
• Clear processed emails cache
• Reset activity history
• Reconfigure API keys

Settings panel coming in next update!`;
    
    this.updateStatus('Settings: ' + settingsInfo.split('\n').slice(0,3).join(' '), 'success');
  }



  addActivity(activity) {
    this.activities.unshift(activity);
    if (this.activities.length > this.maxActivities) {
      this.activities.pop();
    }
    this.updateActivityDisplay();
  }

  updateActivityDisplay() {
    if (this.activities.length === 0) {
      this.activityList.innerHTML = '<div class="activity-item">Waiting for sponsor emails...</div>';
      return;
    }

    this.activityList.innerHTML = this.activities.map(activity => {
      const time = new Date(activity.timestamp).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'});
      const typeClass = activity.type === 'sponsor' ? 'sponsor' : 
                       activity.type === 'scanned' ? 'scanned' : 
                       activity.type === 'error' ? 'error' : '';
      
      // Enhanced display with verification details
      let detailsHtml = '';
      if (activity.details) {
        detailsHtml = `
          <div style="font-size: 10px; opacity: 0.8; margin-top: 2px;">
            ${activity.details.website ? `🌐 ${activity.details.website}` : ''}
            ${activity.details.riskScore ? `⚠️ Risk: ${activity.details.riskScore}` : ''}
            ${activity.details.flags ? `🚩 ${activity.details.flags} flags` : ''}
          </div>
        `;
      }
      
      return `
        <div class="activity-item ${typeClass}">
          <div>${activity.message}</div>
          ${detailsHtml}
          <div class="activity-time">${time}</div>
        </div>
      `;
    }).join('');
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
    // Add detailed verification info to activity list
    const verificationActivity = {
      type: data.status === 'danger' ? 'error' : data.status === 'warning' ? 'scanned' : 'sponsor',
      message: `📧 ${data.extractedInfo?.companyName || 'Email'} - Risk: ${data.riskScore}/100`,
      timestamp: new Date().toISOString(),
      details: {
        company: data.extractedInfo?.companyName || 'Unknown',
        website: data.extractedInfo?.website || 'Not provided',
        contact: data.extractedInfo?.contactPerson || 'Unknown',
        riskScore: data.riskScore,
        status: data.status,
        flags: data.flags?.length || 0
      }
    };
    
    this.addActivity(verificationActivity);
    
    // Update status with key info
    const riskLevel = data.riskScore > 70 ? 'HIGH RISK' : data.riskScore > 40 ? 'MEDIUM RISK' : 'LOW RISK';
    this.updateStatus(`✅ Verified: ${data.extractedInfo?.companyName || 'Email'} - ${riskLevel}`, 
                     data.status === 'danger' ? 'error' : 'success');
  }

  displaySponsorInfo(data) {
    // Display sponsor opportunity details
    const sponsorActivity = {
      type: 'sponsor',
      message: `🎯 SPONSOR: ${data.companyName} - ${data.offer?.slice(0, 50)}...`,
      timestamp: new Date().toISOString(),
      details: {
        company: data.companyName,
        website: data.website,
        contact: data.contactPerson,
        offer: data.offer,
        confidence: data.confidence || 'Medium'
      }
    };
    
    this.addActivity(sponsorActivity);
    this.updateStatus(`🎯 New sponsor detected: ${data.companyName}`, 'success');
  }

}

// Initialize popup when DOM is loaded
document.addEventListener('DOMContentLoaded', () => {
  new PopupController();
}); 