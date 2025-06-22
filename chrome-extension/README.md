# SponsorGuard AI Agent - Integrated Email Detection System

Complete AI-powered solution for influencers to automatically detect, analyze, and track sponsor emails in Gmail with sophisticated verification and Google Docs integration.

## 🚀 Features

### AI-Powered Email Analysis
- **Advanced Verification**: WHOIS domain checking, LinkedIn profile verification, phone number validation
- **Risk Assessment**: Comprehensive scoring system (0-100) with multi-layered security analysis
- **Company Intelligence**: Automatic extraction of company names, websites, contact details, and offers
- **Scam Detection**: Pattern recognition for fraudulent emails and social engineering attempts

### Chrome Extension Integration
- **Real-time Gmail Monitoring**: Automatically scans incoming emails as they arrive
- **Smart Sponsor Detection**: Enhanced keyword matching combined with AI verification
- **Visual Indicators**: Adds confidence-based labels to sponsor emails in Gmail interface
- **Instant Notifications**: Immediate alerts for high-value sponsor opportunities

### Google Docs Automation
- **Auto-Export**: Automatically creates and updates daily sponsor tracking documents
- **Rich Formatting**: Professional formatting with company details, risk assessment, and verification results
- **Centralized Dashboard**: Single document with all sponsor opportunities for easy review
- **Shareable Reports**: Perfect for sharing with managers or team members

## 📁 Project Structure

```
email_scam_detector/
├── app/                          # Next.js web application
│   ├── api/verify/route.ts      # AI analysis API endpoint
│   ├── page.tsx                 # Web interface for manual analysis
│   └── globals.css              # Web app styling
├── chrome-extension/            # Chrome extension files
│   ├── manifest.json           # Extension configuration
│   ├── background.js           # AI analysis & Google Docs integration
│   ├── content.js              # Gmail DOM manipulation
│   ├── popup.html              # Extension popup interface
│   ├── popup.js                # Popup functionality
│   └── style.css               # Gmail integration styles
├── package.json                # Project dependencies
└── README.md                   # This file
```

## 🔧 Setup Instructions

### 1. Backend API Setup

```bash
# Install dependencies
npm install

# Set up environment variables
cp .env.example .env

# Add your API keys to .env:
OPENAI_API_KEY=your_openai_key
WHOIS_API_KEY=your_whois_key
GOOGLE_SAFE_BROWSING_API_KEY=your_google_key
SERP_API_KEY=your_serp_key

# Start the Next.js development server
npm run dev
```

The API will be available at `http://localhost:3000`

### 2. Chrome Extension Setup

#### Google Cloud Console Configuration
1. Go to [Google Cloud Console](https://console.cloud.google.com/)
2. Create a new project or select existing one
3. Enable these APIs:
   - Google Docs API
   - Google Drive API
   - Gmail API (read-only)
4. Create OAuth 2.0 credentials:
   - Application type: Desktop application
   - Add authorized origins: `chrome-extension://`
5. Copy the Client ID

#### Extension Installation
1. Update `chrome-extension/manifest.json`:
   ```json
   "oauth2": {
     "client_id": "YOUR_ACTUAL_GOOGLE_CLIENT_ID"
   }
   ```

2. Open Chrome and navigate to `chrome://extensions/`
3. Enable "Developer mode" (top right toggle)
4. Click "Load unpacked" and select the `chrome-extension` folder
5. Pin the extension to your toolbar for easy access

### 3. Gmail Integration
1. Open Gmail in Chrome
2. The extension will automatically start monitoring emails
3. Click the extension icon to view stats and open Google Docs
4. Sponsor emails will be automatically labeled and highlighted

## 🎯 How It Works

### 1. Email Detection Pipeline
```
Gmail Email → Content Script → Background Service → AI API → Analysis Result
     ↓              ↓               ↓               ↓           ↓
Visual Label ← UI Update ← Google Docs ← Enhanced ← Multi-layer
                          Export      Detection   Verification
```

### 2. Sponsor Detection Algorithm
1. **Keyword Filtering**: Initial screening for sponsor-related terms
2. **AI Analysis**: Sends to Next.js API for comprehensive verification
3. **Multi-Signal Detection**:
   - Low risk score (< 40) indicates legitimate business
   - Professional email domains (non-Gmail/Yahoo)
   - Extracted business information
   - Sponsor keywords present
4. **Confidence Scoring**: HIGH/MEDIUM/LOW based on multiple factors

### 3. Verification Process
- **Domain Analysis**: Age, registrar, country verification via WHOIS
- **Website Verification**: Checks if company websites are live and legitimate
- **LinkedIn Validation**: Verifies contact person exists and works at claimed company
- **Phone Verification**: Validates phone numbers and area codes
- **Content Analysis**: AI-powered detection of scam patterns and urgency tactics

## 🔍 API Endpoints

### POST `/api/verify`
Analyzes email content for sponsor detection and security verification.

**Request Body:**
```json
{
  "emailContent": "Subject: Partnership Opportunity\nFrom: marketing@company.com\nBody: We would like to collaborate..."
}
```

**Response:**
```json
{
  "riskScore": 25,
  "status": "safe",
  "isSponsor": true,
  "extractedInfo": {
    "companyName": "Tech Company Inc",
    "website": "https://company.com",
    "contactPerson": "John Smith",
    "offer": "Product review partnership with $500 compensation"
  },
  "flags": [
    {"type": "green", "message": "Domain registered 5 years ago"},
    {"type": "green", "message": "LinkedIn profile verified"}
  ],
  "summary": "Legitimate sponsor opportunity from established company",
  "suggestedAction": "Safe to proceed with verification"
}
```

## 🎨 Chrome Extension Features

### Real-time Stats Dashboard
- **Emails Scanned**: Total emails processed today
- **Sponsors Found**: Confirmed sponsor opportunities
- **Docs Updated**: Number of Google Docs exports
- **API Status**: Live connection status to analysis API

### Visual Gmail Integration
- **Sponsor Labels**: Color-coded confidence indicators
- **Email Highlighting**: Border and background highlighting
- **Animations**: Subtle pulse effects for new detections
- **Dark Mode Support**: Automatic adaptation to Gmail themes

### Debug Tools
- **Console Debugging**: Enable detailed logging in Gmail
- **Manual Rescan**: Force re-analysis of current emails
- **Stats Monitoring**: Real-time processing statistics

## 🛠️ Development

### Testing the Extension
1. Load test emails in Gmail (use sample sponsor emails)
2. Monitor Chrome DevTools console for debug output
3. Check extension popup for real-time stats
4. Verify Google Docs integration

### Debug Commands (in Gmail console)
```javascript
// Enable debug mode
sponsorGuardDebug()

// Get current stats
window.sponsorGuard.getStats()

// Force rescan
sponsorGuardRescan()
```

### API Testing
```bash
# Test the verification endpoint
curl -X POST http://localhost:3000/api/verify \
  -H "Content-Type: application/json" \
  -d '{"emailContent": "Subject: Sponsor Opportunity\nWe would like to partner with your channel..."}'
```

## 🔒 Security & Privacy

- **Local Processing**: All analysis happens locally or through your own API
- **OAuth Security**: Google authentication uses minimal required scopes
- **No Data Collection**: Extension doesn't send data to third-party services
- **Encrypted Storage**: Sensitive data stored securely in Chrome storage

## 📊 Performance

- **Lightweight**: Extension adds minimal overhead to Gmail
- **Efficient**: Smart filtering reduces unnecessary API calls
- **Scalable**: Handles high email volumes with debounced processing
- **Reliable**: Graceful fallback when API is unavailable

## 🐛 Troubleshooting

### Common Issues

1. **Extension not detecting emails**
   - Check if API is running (`npm run dev`)
   - Verify Gmail is fully loaded before refreshing
   - Enable debug mode to see console logs

2. **Google Docs integration failing**
   - Verify OAuth credentials in manifest.json
   - Check Google Cloud Console API permissions
   - Re-authenticate through extension popup

3. **API errors**
   - Ensure environment variables are set correctly
   - Check OpenAI API key validity
   - Verify WHOIS and other service keys

### Debug Steps
1. Open Chrome DevTools in Gmail tab
2. Check Console tab for error messages
3. Click extension icon to view status
4. Use debug commands for detailed logging

## 🚀 Deployment

### Production Setup
1. Set up production environment variables
2. Deploy Next.js app to your hosting platform
3. Update extension manifest with production API URL
4. Package extension for Chrome Web Store (optional)

### Environment Variables
```bash
# Required for full functionality
OPENAI_API_KEY=sk-...
WHOIS_API_KEY=at_...
GOOGLE_SAFE_BROWSING_API_KEY=...
SERP_API_KEY=...

# Optional but recommended
NODE_ENV=production
```

## 📈 Future Enhancements

- **Multi-platform Support**: Firefox and Safari extensions
- **Advanced Analytics**: Detailed sponsor opportunity insights
- **Team Collaboration**: Shared tracking across multiple users
- **Integration APIs**: Connect with CRM and project management tools
- **Mobile App**: Companion mobile application

## 📄 License

MIT License - Feel free to modify and distribute

---

**Happy Sponsorship Hunting! 🎯**

For support or feature requests, please open an issue in the repository. 