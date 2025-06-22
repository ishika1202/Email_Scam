import { NextRequest, NextResponse } from 'next/server'
import { OpenAI } from 'openai'
import axios from 'axios'
import * as cheerio from 'cheerio'
import validator from 'validator'

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
})

/*
 * SCAM DETECTION RULES IMPLEMENTATION:
 * 
 * Rule #1: Company Website & Domain Verification
 *   - checkWebsiteLiveness(): Verifies websites are live and accessible
 *   - checkDomainWhois(): Checks domain age (must be 2+ years for green flag)
 *   - Enhanced domain age scoring with stricter criteria
 * 
 * Rule #2: Phone Number Validation  
 *   - verifyPhoneNumbers(): Validates format, area codes, business lines
 *   - Detects invalid/fake numbers (555, 900 area codes, etc.)
 * 
 * Rule #3: Urgency & Red Flag Detection
 *   - detectUrgencyFlags(): Scans for urgency tactics and scam phrases
 *   - Detects payment red flags (crypto, gift cards, wire transfers)
 *   - AI analysis for suspicious language patterns
 * 
 * Rule #4: Person Verification
 *   - verifyLinkedInProfile(): Real LinkedIn verification via SerpApi
 *   - Detects identity spoofing attempts
 *   - Verifies person exists and works at claimed company
 */

interface VerificationResult {
  riskScore: number
  status: 'safe' | 'warning' | 'danger'
  flags: {
    type: 'green' | 'yellow' | 'red'
    message: string
  }[]
  domainInfo: {
    age: string
    registrar: string
    country: string
  }
  extractedInfo: {
    companyName: string
    website: string
    contactPerson: string
    offer: string
  }
  summary: string
  suggestedAction: string
}

// Extract emails, URLs, and phone numbers from text
function extractEmailsAndUrls(text: string) {
  const emails = text.match(/\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b/g) || []
  const urls = text.match(/https?:\/\/[^\s<>"{}|\\^`[\]]+/g) || []
  
  // Extract phone numbers (various formats)
  const phoneRegex = /(?:\+?1[-.\s]?)?\(?([0-9]{3})\)?[-.\s]?([0-9]{3})[-.\s]?([0-9]{4})(?:\s?(?:ext|extension|x)\.?\s?(\d+))?/g
  const internationalPhoneRegex = /\+([1-9]\d{0,3})\s?(\d{1,4})\s?(\d{3,4})\s?(\d{4})/g
  
  const phones: string[] = []
  let match
  
  // US/Canada format
  while ((match = phoneRegex.exec(text)) !== null) {
    phones.push(match[0].trim())
  }
  
  // International format
  while ((match = internationalPhoneRegex.exec(text)) !== null) {
    phones.push(match[0].trim())
  }
  
  return { emails, urls, phones: [...new Set(phones)] }
}

// Extract domain from URL/email
function extractDomain(input: string): string {
  try {
    if (input.includes('@')) {
      return input.split('@')[1]
    }
    const url = new URL(input.startsWith('http') ? input : `https://${input}`)
    return url.hostname
  } catch {
    return input
  }
}

// Check domain with WHOIS API (WhoisXML API)
async function checkDomainWhois(domain: string) {
  try {
    if (!process.env.WHOIS_API_KEY) {
      return {
        age: 'API key missing',
        registrar: 'Unknown',
        country: 'Unknown',
        createdDate: null
      }
    }

    const response = await axios.get(`https://www.whoisxmlapi.com/whoisserver/WhoisService`, {
      params: {
        apiKey: process.env.WHOIS_API_KEY,
        domainName: domain,
        outputFormat: 'JSON'
      },
      timeout: 10000
    })

    const data = response.data
    const registryData = data.WhoisRecord?.registryData || {}
    const createdDate = registryData.createdDate || data.WhoisRecord?.createdDate

    let age = 'Unknown'
    if (createdDate) {
      const created = new Date(createdDate)
      const now = new Date()
      const years = Math.floor((now.getTime() - created.getTime()) / (365.25 * 24 * 60 * 60 * 1000))
      const months = Math.floor(((now.getTime() - created.getTime()) % (365.25 * 24 * 60 * 60 * 1000)) / (30.44 * 24 * 60 * 60 * 1000))
      
      if (years > 0) {
        age = `${years} year${years !== 1 ? 's' : ''}, ${months} month${months !== 1 ? 's' : ''}`
      } else {
        age = `${months} month${months !== 1 ? 's' : ''}`
      }
    }

    return {
      age,
      registrar: registryData.registrarName || data.WhoisRecord?.registrarName || 'Unknown',
      country: registryData.registrant?.country || 'Unknown',
      createdDate
    }
  } catch (error) {
    console.error('WHOIS check error:', error)
    return {
      age: 'Query failed',
      registrar: 'Unknown',
      country: 'Unknown',
      createdDate: null
    }
  }
}

// Google Safe Browsing API check
async function checkGoogleSafeBrowsing(urls: string[]) {
  const flags: any[] = []
  
  if (!process.env.GOOGLE_SAFE_BROWSING_API_KEY) {
    // Fallback to basic pattern checks if no API key
    for (const url of urls) {
      try {
        const domain = extractDomain(url)
        
        if (domain.includes('bit.ly') || domain.includes('tinyurl') || domain.includes('t.co')) {
          flags.push({
            type: 'yellow',
            message: `URL shortener detected: ${domain} - Could hide the real destination`
          })
        }
        
        if (domain.includes('crypto') || domain.includes('bitcoin') || domain.includes('nft')) {
          flags.push({
            type: 'yellow',
            message: `Crypto-related domain: ${domain} - Common in scam emails`
          })
        }
      } catch (error) {
        console.error('Pattern check error:', error)
      }
    }
    return flags
  }

  // Real Google Safe Browsing API implementation
  try {
    if (urls.length === 0) return flags

    const response = await axios.post(
      `https://safebrowsing.googleapis.com/v4/threatMatches:find?key=${process.env.GOOGLE_SAFE_BROWSING_API_KEY}`,
      {
        client: {
          clientId: "sponsor-guard",
          clientVersion: "1.0.0"
        },
        threatInfo: {
          threatTypes: ["MALWARE", "SOCIAL_ENGINEERING", "UNWANTED_SOFTWARE", "POTENTIALLY_HARMFUL_APPLICATION"],
          platformTypes: ["ANY_PLATFORM"],
          threatEntryTypes: ["URL"],
          threatEntries: urls.map(url => ({ url }))
        }
      },
      {
        timeout: 10000,
        headers: {
          'Content-Type': 'application/json'
        }
      }
    )

    if (response.data.matches && response.data.matches.length > 0) {
      response.data.matches.forEach((match: any) => {
        flags.push({
          type: 'red',
          message: `Google Safe Browsing: ${match.threat.url} flagged for ${match.threatType}`
        })
      })
    }

    // Still do pattern checks
    for (const url of urls) {
      const domain = extractDomain(url)
      if (domain.includes('bit.ly') || domain.includes('tinyurl') || domain.includes('t.co')) {
        flags.push({
          type: 'yellow',
          message: `URL shortener detected: ${domain}`
        })
      }
    }

  } catch (error) {
    console.error('Google Safe Browsing API error:', error)
    // Fallback to pattern checks
    for (const url of urls) {
      const domain = extractDomain(url)
      if (domain.includes('bit.ly') || domain.includes('tinyurl') || domain.includes('t.co')) {
        flags.push({
          type: 'yellow',
          message: `URL shortener detected: ${domain} (API unavailable)`
        })
      }
    }
  }
  
  return flags
}

// Phone number verification
async function verifyPhoneNumbers(phones: string[], companyName?: string) {
  const flags: any[] = []
  
  if (phones.length === 0) {
    return flags
  }
  
  for (const phone of phones) {
    try {
      // Clean phone number
      const cleanPhone = phone.replace(/[^\d+]/g, '')
      
      // Basic validation
      const validation = validatePhoneNumber(cleanPhone, companyName)
      
      if (validation.isValid) {
        flags.push({
          type: 'green',
          message: `Phone verification: ${phone} is valid ${validation.country || 'number'}`
        })
        
        if (validation.isBusinessLine) {
          flags.push({
            type: 'green',
            message: `Phone verification: ${phone} appears to be a business line`
          })
        }
        
        if (validation.countryMismatch) {
          flags.push({
            type: 'yellow',
            message: `Phone verification: ${phone} country doesn't match company location`
          })
        }
      } else {
        flags.push({
          type: 'red',
          message: `Phone verification: ${phone} appears to be invalid format`
        })
      }
      
    } catch (error) {
      console.error('Phone verification error:', error)
    }
  }
  
  return flags
}

// Phone number validation function
function validatePhoneNumber(phone: string, companyName?: string) {
  // Remove + and spaces for processing
  const digits = phone.replace(/^\+/, '')
  
  // US/Canada numbers (country code 1)
  if (digits.startsWith('1') && digits.length === 11) {
    const areaCode = digits.substring(1, 4)
    
    // Check for invalid area codes
    const invalidAreaCodes = ['000', '111', '222', '333', '444', '555', '666', '777', '888', '999']
    if (invalidAreaCodes.includes(areaCode)) {
      return { isValid: false }
    }
    
    // Check for premium/suspicious numbers
    const premiumAreaCodes = ['900', '976', '550'] // Common scam prefixes
    const isPremium = premiumAreaCodes.includes(areaCode)
    
    return {
      isValid: true,
      country: 'US/Canada',
      isBusinessLine: !isPremium && !areaCode.startsWith('555'), // 555 often fake
      countryMismatch: false
    }
  }
  
  // UK numbers (country code 44)
  if (digits.startsWith('44') && digits.length >= 12 && digits.length <= 13) {
    return {
      isValid: true,
      country: 'United Kingdom',
      isBusinessLine: true,
      countryMismatch: false
    }
  }
  
  // Other international numbers (basic validation)
  if (digits.length >= 10 && digits.length <= 15) {
    const countryCode = digits.substring(0, 2)
    const commonCodes = ['1', '44', '49', '33', '39', '34', '31', '46', '47', '45', '41', '43', '32']
    
    return {
      isValid: commonCodes.includes(countryCode) || digits.length >= 11,
      country: 'International',
      isBusinessLine: true,
      countryMismatch: false
    }
  }
  
  // US local numbers (10 digits)
  if (digits.length === 10) {
    const areaCode = digits.substring(0, 3)
    const invalidAreaCodes = ['000', '111', '222', '333', '444', '555', '666', '777', '888', '999']
    
    return {
      isValid: !invalidAreaCodes.includes(areaCode),
      country: 'US/Canada',
      isBusinessLine: !areaCode.startsWith('555'),
      countryMismatch: false
    }
  }
  
  return { isValid: false }
}

// LinkedIn profile verification
async function verifyLinkedInProfile(emailContent: string) {
  const flags: any[] = []
  
  try {
    // Extract person name and company from email using AI
    const extractionPrompt = `
    Extract the following information from this email:
    - Contact person's full name
    - Company name they claim to work for
    - Their job title/position
    
    Email content:
    "${emailContent}"
    
    Return JSON with:
    - personName: "Full Name" (or null if not found)
    - companyName: "Company Name" (or null if not found)  
    - jobTitle: "Job Title" (or null if not found)
    `

    const extraction = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        {
          role: "system",
          content: "Extract contact information from emails accurately. Return only JSON."
        },
        {
          role: "user",
          content: extractionPrompt
        }
      ],
      response_format: { type: "json_object" },
      temperature: 0.1,
    })

    const extracted = JSON.parse(extraction.choices[0].message.content || '{}')
    
    if (extracted.personName && extracted.companyName) {
      // Search LinkedIn using SerpApi
      const linkedinResult = await searchLinkedIn(extracted.personName, extracted.companyName, extracted.jobTitle)
      
      if (linkedinResult.found) {
        const flagType = linkedinResult.confidence === 'high' ? 'green' : 'yellow'
        const message = linkedinResult.confidence === 'high' 
          ? `LinkedIn verified: ${extracted.personName} profile found at ${extracted.companyName} (${linkedinResult.apiUsed})`
          : `LinkedIn partial match: ${extracted.personName} found but employment verification unclear (${linkedinResult.apiUsed})`
        
        flags.push({
          type: flagType,
          message: message
        })
      } else if (linkedinResult.confidence === 'spoofing_detected') {
        // Person clearly works at different company - suspicious
        flags.push({
          type: 'red',
          message: `🚨 Identity verification failed: ${extracted.personName} found working at different company - potential impersonation (${linkedinResult.apiUsed})`
        })
      } else if (linkedinResult.confidence === 'unclear') {
        // Person found but employment unclear - could be outdated profile
        flags.push({
          type: 'yellow',
          message: `⚠️ Employment verification unclear: ${extracted.personName} found on LinkedIn but current role at ${extracted.companyName} not confirmed - may be outdated profile (${linkedinResult.apiUsed})`
        })
      } else if (linkedinResult.companyExists) {
        // Company exists but person not found
        flags.push({
          type: 'yellow',
          message: `Company verified but person not found: ${extracted.companyName} exists but no ${extracted.personName} profile found (${linkedinResult.apiUsed})`
        })
      } else if (linkedinResult.searched) {
        if (linkedinResult.apiUsed === 'SerpApi') {
          flags.push({
            type: 'red',
            message: `LinkedIn verification failed: Neither ${extracted.personName} nor ${extracted.companyName} found on LinkedIn`
          })
        } else {
          flags.push({
            type: 'yellow',
            message: `LinkedIn check: Could not verify ${extracted.personName} at ${extracted.companyName} (API needed)`
          })
        }
      }
    }

  } catch (error) {
    console.error('LinkedIn verification error:', error)
    // Don't add flags on errors to avoid false negatives
  }
  
  return flags
}

// Real LinkedIn search using SerpApi
async function searchLinkedIn(personName: string, companyName: string, jobTitle?: string) {
  // First try real SerpApi search
  if (process.env.SERPAPI_API_KEY) {
    try {
      const searchQuery = `"${personName}" ${companyName} site:linkedin.com/in`
      
      const response = await axios.get('https://serpapi.com/search', {
        params: {
          engine: 'google',
          q: searchQuery,
          api_key: process.env.SERPAPI_API_KEY,
          num: 5
        },
        timeout: 10000
      })

      const results = response.data.organic_results || []
      
      // Look for LinkedIn profile matches with strict criteria
      const linkedinProfiles = results.filter((result: any) => {
        if (!result.link || !result.link.includes('linkedin.com/in')) return false
        
        const title = result.title.toLowerCase()
        const snippet = (result.snippet || '').toLowerCase()
        const personLower = personName.toLowerCase()
        const companyLower = companyName.toLowerCase()
        
        // Must contain person name
        const hasPersonName = title.includes(personLower)
        if (!hasPersonName) return false
        
        // Must have strong company association (not just mention)
        const strongCompanyMatch = 
          title.includes(`at ${companyLower}`) ||
          title.includes(`@ ${companyLower}`) ||
          snippet.includes(`works at ${companyLower}`) ||
          snippet.includes(`employee at ${companyLower}`) ||
          snippet.includes(`${companyLower} employee`) ||
          (title.includes(companyLower) && (title.includes('ceo') || title.includes('founder') || title.includes('director')))
        
        return strongCompanyMatch
      })

      if (linkedinProfiles.length > 0) {
        const profile = linkedinProfiles[0]
        
        // Additional verification for strong employment connection
        const title = profile.title.toLowerCase()
        const snippet = (profile.snippet || '').toLowerCase()
        const hasJobTitle = jobTitle && (title.includes(jobTitle.toLowerCase()) || snippet.includes(jobTitle.toLowerCase()))
        const hasCurrentRole = title.includes('at ') || title.includes('@ ') || snippet.includes('currently') || snippet.includes('works at')
        
        // Only give high confidence if we have clear employment indicators
        const confidence = (hasJobTitle || hasCurrentRole) ? 'high' : 'medium'
        
        return {
          found: true,
          searched: true,
          profileUrl: profile.link,
          confidence: confidence,
          apiUsed: 'SerpApi',
          note: confidence === 'medium' ? 'Profile found but employment verification unclear' : 'Strong employment verification'
        }
      }
      
      // Check for potential identity spoofing - person exists but not at this company
      const personOnlyQuery = `"${personName}" site:linkedin.com/in`
      const personResponse = await axios.get('https://serpapi.com/search', {
        params: {
          engine: 'google',
          q: personOnlyQuery,
          api_key: process.env.SERPAPI_API_KEY,
          num: 3
        },
        timeout: 8000
      })
      
      const personResults = personResponse.data.organic_results || []
      const personProfiles = personResults.filter((result: any) => {
        if (!result.link || !result.link.includes('linkedin.com/in')) return false
        
        const title = result.title.toLowerCase()
        const snippet = (result.snippet || '').toLowerCase()
        const personLower = personName.toLowerCase()
        
        // Check for exact name match or partial matches (first/last name)
        const nameParts = personLower.split(' ')
        const hasNameMatch = title.includes(personLower) || 
          (nameParts.length >= 2 && nameParts.every(part => part.length > 2 && title.includes(part)))
        
        return hasNameMatch
      })

      // Also search for company LinkedIn page as verification
      const companyQuery = `"${companyName}" site:linkedin.com/company`
      const companyResponse = await axios.get('https://serpapi.com/search', {
        params: {
          engine: 'google',
          q: companyQuery,
          api_key: process.env.SERPAPI_API_KEY,
          num: 3
        },
        timeout: 8000
      })

      const companyResults = companyResponse.data.organic_results || []
      const companyPages = companyResults.filter((result: any) => 
        result.link && result.link.includes('linkedin.com/company')
      )

      // Check if we found the person but they're not at this company 
      // Only flag as suspicious if it's a very clear mismatch
      if (personProfiles.length > 0 && companyPages.length > 0) {
        // Check if person clearly works at a DIFFERENT company
        const personProfile = personProfiles[0]
        const title = personProfile.title.toLowerCase()
        const snippet = (personProfile.snippet || '').toLowerCase()
        
        // Look for clear employment at different company
        const hasOtherEmployment = title.includes(' at ') && !title.includes(companyName.toLowerCase())
        
        if (hasOtherEmployment) {
          return {
            found: false,
            searched: true,
            profileUrl: personProfile.link,
            companyExists: true,
            companyUrl: companyPages[0].link,
            confidence: 'spoofing_detected',
            apiUsed: 'SerpApi',
            note: `${personName} found working at different company - potential identity spoofing`
          }
        }
        
        // Otherwise, just note that verification is unclear (could be outdated profile)
        return {
          found: false,
          searched: true,
          profileUrl: personProfile.link,
          companyExists: true,
          companyUrl: companyPages[0].link,
          confidence: 'unclear',
          apiUsed: 'SerpApi',
          note: `${personName} found but employment at ${companyName} not confirmed - may be outdated profile`
        }
      }

      return {
        found: false,
        searched: true,
        profileUrl: null,
        companyExists: companyPages.length > 0,
        companyUrl: companyPages.length > 0 ? companyPages[0].link : null,
        confidence: companyPages.length > 0 ? 'medium' : 'low',
        apiUsed: 'SerpApi'
      }

    } catch (error) {
      console.error('SerpApi LinkedIn search error:', error)
      // Fall through to fallback method
    }
  }

  // Fallback to basic company verification for known companies
  try {
    const commonLegitCompanies = [
      'nike', 'adidas', 'apple', 'google', 'microsoft', 'amazon', 'meta', 'facebook',
      'spotify', 'netflix', 'adobe', 'salesforce', 'intel', 'nvidia', 'samsung',
      'coca-cola', 'pepsi', 'mcdonalds', 'starbucks', 'target', 'walmart', 'disney',
      'uber', 'airbnb', 'twitter', 'linkedin', 'tesla', 'paypal', 'ebay', 'yahoo'
    ]
    
    const companyLower = companyName.toLowerCase()
    const isKnownCompany = commonLegitCompanies.some(company => 
      companyLower.includes(company) || company.includes(companyLower)
    )
    
    return {
      found: false,
      searched: true,
      profileUrl: null,
      companyExists: isKnownCompany,
      confidence: isKnownCompany ? 'medium' : 'low',
      apiUsed: 'fallback'
    }

  } catch (error) {
    console.error('LinkedIn fallback search error:', error)
    return {
      found: false,
      searched: false,
      profileUrl: null,
      confidence: 'none',
      apiUsed: 'none'
    }
  }
}

// Extract business information from email
async function extractBusinessInfo(emailContent: string) {
  try {
    const prompt = `
    Extract the following business information from this email:
    - Company name (the business offering the sponsorship)
    - Company website (if mentioned)
    - Contact person name
    - Brief description of the offer/sponsorship

    Email content:
    "${emailContent}"
    
    Return JSON with:
    - companyName: "Company Name" (or "Not specified" if not clear)
    - website: "website.com" (or "Not provided" if not mentioned)
    - contactPerson: "Person Name" (or "Not specified" if not clear)
    - offer: "Brief description of offer" (or "Not specified" if not clear)
    `

    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        {
          role: "system",
          content: "Extract business information from emails accurately. Return only JSON."
        },
        {
          role: "user",
          content: prompt
        }
      ],
      response_format: { type: "json_object" },
      temperature: 0.1,
    })

    const result = JSON.parse(completion.choices[0].message.content || '{}')
    return result
  } catch (error) {
    console.error('Business info extraction error:', error)
    return {
      companyName: 'Extraction failed',
      website: 'Not available',
      contactPerson: 'Not available',
      offer: 'Not available'
    }
  }
}

// AI-powered content analysis
async function analyzeEmailContent(emailContent: string) {
  try {
    const prompt = `
    Analyze this sponsor email for legitimacy. Be GENEROUS to legitimate businesses and STRICT on actual scams.

    STRONG LEGITIMACY INDICATORS (score 80-100):
    - Professional email domain matching company name (@nike.com, @stan.store)
    - Specific contact person with full name and title
    - Realistic payment ranges ($300-600 for sponsorships is NORMAL)
    - Clear, professional business process described
    - Proper grammar and professional language
    - Real company website provided
    - Specific collaboration details mentioned
    - References to existing creators/partnerships

    MODERATE LEGITIMACY (score 60-80):
    - Professional language but generic details
    - Payment amounts within normal ranges
    - Some business process described
    - Contact information provided

    SCAM INDICATORS (score 0-40):
    - Extreme urgency ("expires today", "act now")
    - Unrealistic payments ($10,000+ immediate offers)
    - Poor grammar/spelling errors
    - Crypto/wire transfer payment methods
    - Requests for SSN, bank details upfront
    - Generic "dear creator" messaging
    - Pressure for immediate personal information
    
    Email content:
    "${emailContent}"
    
    IMPORTANT: $300-600 sponsorship offers are NORMAL and LEGITIMATE for creator partnerships. Do NOT flag realistic payment amounts as suspicious.
    
    Return a JSON object with:
    - riskFactors: array of concerning issues found (empty array if none)
    - legitimacyScore: 0-100 (0=definitely scam, 100=definitely legitimate)
    - overallAssessment: brief assessment focusing on legitimacy
    - redFlags: specific concerning phrases/elements (empty array if none)
    `

    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        {
          role: "system",
          content: "You are an expert at detecting email scams and evaluating sponsor legitimacy. Analyze emails for red flags and provide detailed assessments."
        },
        {
          role: "user",
          content: prompt
        }
      ],
      response_format: { type: "json_object" },
      temperature: 0.3,
    })

    const result = JSON.parse(completion.choices[0].message.content || '{}')
    return result
  } catch (error) {
    console.error('AI analysis error:', error)
    return {
      riskFactors: ['AI analysis unavailable'],
      legitimacyScore: 50,
      overallAssessment: 'Unable to complete AI analysis',
      redFlags: []
    }
  }
}

// Website liveness check (Rule #1)
async function checkWebsiteLiveness(urls: string[]) {
  const flags: any[] = []
  
  if (urls.length === 0) {
    return flags
  }
  
  for (const url of urls.slice(0, 3)) { // Limit to 3 URLs
    try {
      const cleanUrl = url.startsWith('http') ? url : `https://${url}`
      
      const response = await axios.head(cleanUrl, {
        timeout: 8000,
        maxRedirects: 3,
        validateStatus: (status) => status < 500 // Accept redirects
      })
      
      if (response.status >= 200 && response.status < 400) {
        flags.push({
          type: 'green',
          message: `Website verification: ${url} is live and accessible`
        })
      } else {
        flags.push({
          type: 'yellow',
          message: `Website warning: ${url} returned status ${response.status}`
        })
      }
      
    } catch (error: any) {
      if (error.code === 'ENOTFOUND' || error.code === 'ECONNREFUSED') {
        flags.push({
          type: 'red',
          message: `Website verification failed: ${url} is not accessible or doesn't exist`
        })
      } else if (error.response?.status >= 400) {
        flags.push({
          type: 'yellow',
          message: `Website warning: ${url} returned error ${error.response.status}`
        })
      } else {
        flags.push({
          type: 'yellow',
          message: `Website check: Unable to verify ${url} (${error.message})`
        })
      }
    }
  }
  
  return flags
}

// Enhanced urgency and red flag detection (Rule #3)
function detectUrgencyFlags(emailContent: string) {
  const flags: any[] = []
  const content = emailContent.toLowerCase()
  
  // Urgency indicators
  const urgencyPhrases = [
    'act now', 'expires today', 'expires soon', 'limited time', 'urgent', 'immediate',
    'don\'t wait', 'hurry', 'act fast', 'deadline', 'expires in', 'only today',
    'last chance', 'final notice', 'time sensitive', 'act immediately'
  ]
  
  // Scam red flags
  const redFlagPhrases = [
    'wire transfer', 'western union', 'moneygram', 'bitcoin', 'cryptocurrency',
    'crypto', 'send money', 'upfront payment', 'processing fee', 'advance fee',
    'social security', 'ssn', 'bank account', 'routing number', 'credit card',
    'verify your account', 'suspended account', 'click here immediately',
    'congratulations you\'ve won', 'claim your prize', 'tax refund'
  ]
  
  // Payment red flags
  const paymentRedFlags = [
    'gift card', 'itunes card', 'amazon card', 'google play card', 'steam card',
    'prepaid card', 'cash app', 'venmo payment', 'zelle payment', 'paypal friends'
  ]
  
  urgencyPhrases.forEach(phrase => {
    if (content.includes(phrase)) {
      flags.push({
        type: 'red',
        message: `Urgency tactic detected: "${phrase}" - common scam pressure technique`
      })
    }
  })
  
  redFlagPhrases.forEach(phrase => {
    if (content.includes(phrase)) {
      flags.push({
        type: 'red',
        message: `Scam indicator detected: "${phrase}" - high risk phrase`
      })
    }
  })
  
  paymentRedFlags.forEach(phrase => {
    if (content.includes(phrase)) {
      flags.push({
        type: 'red',
        message: `Suspicious payment method: "${phrase}" - commonly used in scams`
      })
    }
  })
  
  return flags
}

export async function POST(request: NextRequest) {
  try {
    const { emailContent } = await request.json()

    if (!emailContent || emailContent.trim().length === 0) {
      return NextResponse.json(
        { error: 'Email content is required' },
        { status: 400 }
      )
    }

    // Extract emails, URLs, and phone numbers
    const { emails, urls, phones } = extractEmailsAndUrls(emailContent)
    const domains = [...new Set([
      ...emails.map(email => extractDomain(email)),
      ...urls.map(url => extractDomain(url))
    ])]

    console.log('Extracted:', { emails, urls, phones, domains })

    // Run all checks in parallel following the 4 core rules
    const [
      aiAnalysis,
      businessInfo,
      safeBrowsingFlags,
      linkedinFlags,
      phoneFlags,
      websiteLivenessFlags,
      urgencyFlags,
      ...domainChecks
    ] = await Promise.all([
      analyzeEmailContent(emailContent),
      extractBusinessInfo(emailContent),
      checkGoogleSafeBrowsing(urls), // Rule #1 (part)
      verifyLinkedInProfile(emailContent), // Rule #4
      verifyPhoneNumbers(phones), // Rule #2
      checkWebsiteLiveness(urls), // Rule #1 (website live check)
      Promise.resolve(detectUrgencyFlags(emailContent)), // Rule #3 (sync function)
      ...domains.slice(0, 3).map(domain => checkDomainWhois(domain)) // Rule #1 (domain age)
    ])

    // Combine all flags following the 4 core scam detection rules
    const allFlags: any[] = [
      ...safeBrowsingFlags,
      ...linkedinFlags,
      ...phoneFlags,
      ...websiteLivenessFlags, // Rule #1: Website liveness
      ...urgencyFlags, // Rule #3: Urgency/red flag detection
    ]

    // Add basic pattern checks for domains (replacing IPQualityScore)
    domains.forEach(domain => {
      if (domain.length > 30) {
        allFlags.push({
          type: 'yellow',
          message: `Unusually long domain name: ${domain}`
        })
      }
      
      if (domain.includes('temporary') || domain.includes('disposable') || domain.includes('guerrilla')) {
        allFlags.push({
          type: 'red',
          message: `Temporary email service: ${domain}`
        })
      }

      if (domain.includes('crypto') || domain.includes('bitcoin') || domain.includes('nft')) {
        allFlags.push({
          type: 'yellow',
          message: `Crypto-related domain: ${domain} - Common in scam emails`
        })
      }
    })

    // Add AI analysis flags
    if (aiAnalysis.riskFactors) {
      aiAnalysis.riskFactors.forEach((factor: string) => {
        allFlags.push({
          type: 'yellow',
          message: `AI detected: ${factor}`
        })
      })
    }

    if (aiAnalysis.redFlags && aiAnalysis.redFlags.length > 0) {
      aiAnalysis.redFlags.forEach((flag: string) => {
        allFlags.push({
          type: 'red',
          message: `Red flag: ${flag}`
        })
      })
    }

    // Enhanced domain age and legitimacy checks (Rule #1)
    domainChecks.forEach((domainInfo, index) => {
      const domain = domains[index]
      if (domainInfo && domain) {
        if (domainInfo.age !== 'Unknown' && domainInfo.age !== 'Query failed' && domainInfo.age !== 'API key missing') {
          // Parse age and add appropriate flags with stricter criteria
          if (domainInfo.age.includes('year')) {
            const years = parseInt(domainInfo.age)
            if (years >= 5) {
              allFlags.push({
                type: 'green',
                message: `Domain ${domain} is ${domainInfo.age} old - well established and trustworthy`
              })
            } else if (years >= 2) {
              allFlags.push({
                type: 'green',
                message: `Domain ${domain} is ${domainInfo.age} old - established`
              })
            } else if (years >= 1) {
              allFlags.push({
                type: 'yellow',
                message: `Domain ${domain} is ${domainInfo.age} old - relatively new, verify legitimacy`
              })
            } else {
              allFlags.push({
                type: 'red',
                message: `Domain ${domain} is less than 1 year old - very new domain, high risk`
              })
            }
          } else if (domainInfo.age.includes('month')) {
            const months = parseInt(domainInfo.age)
            if (months < 3) {
              allFlags.push({
                type: 'red',
                message: `Domain ${domain} is only ${domainInfo.age} old - extremely new domain, very high risk`
              })
            } else if (months < 6) {
              allFlags.push({
                type: 'red',
                message: `Domain ${domain} is only ${domainInfo.age} old - very new domain, high risk`
              })
            } else {
              allFlags.push({
                type: 'yellow',
                message: `Domain ${domain} is ${domainInfo.age} old - fairly new, proceed with caution`
              })
            }
          } else if (domainInfo.age.includes('day')) {
            allFlags.push({
              type: 'red',
              message: `Domain ${domain} is only ${domainInfo.age} old - brand new domain, extremely high risk`
            })
          }

          // Check registrar reputation
          const knownRegistrars = ['GoDaddy', 'Namecheap', 'Google', 'Cloudflare', 'Amazon', 'Network Solutions', 'Tucows']
          if (knownRegistrars.some(reg => domainInfo.registrar.includes(reg))) {
            allFlags.push({
              type: 'green',
              message: `Domain ${domain} registered with reputable registrar: ${domainInfo.registrar}`
            })
          } else {
            allFlags.push({
              type: 'yellow',
              message: `Domain ${domain} registered with unknown registrar: ${domainInfo.registrar} - verify legitimacy`
            })
          }
        } else if (domainInfo.age === 'API key missing') {
          allFlags.push({
            type: 'yellow',
            message: `Domain ${domain} - WHOIS check unavailable (API key needed)`
          })
        }
      }
    })

    // Calculate risk score with improved logic
    const aiLegitimacyScore = aiAnalysis.legitimacyScore || 50
    
    // Convert legitimacy score to risk score (higher legitimacy = lower risk)
    let baseRiskScore = 100 - aiLegitimacyScore
    
    // Count flag types for balanced scoring
    const flagCounts = allFlags.reduce((counts, flag) => {
      counts[flag.type] = (counts[flag.type] || 0) + 1
      return counts
    }, {} as Record<string, number>)
    
    const redFlags = flagCounts.red || 0
    const yellowFlags = flagCounts.yellow || 0
    const greenFlags = flagCounts.green || 0
    
    // Apply flag adjustments with diminishing returns
    let flagAdjustment = 0
    flagAdjustment += Math.min(redFlags * 12, 40)     // Max 40 points from red flags
    flagAdjustment += Math.min(yellowFlags * 3, 20)   // Max 20 points from yellow flags  
    flagAdjustment -= Math.min(greenFlags * 8, 50)    // Max 50 point reduction from green flags
    
    // If we have many green flags and few/no red flags, heavily favor legitimacy
    if (greenFlags >= 3 && redFlags === 0) {
      flagAdjustment -= 20 // Extra bonus for clearly legitimate emails
    }
    
    // If AI says highly legitimate (85+) and no red flags, cap risk at 15%
    if (aiLegitimacyScore >= 85 && redFlags === 0) {
      baseRiskScore = Math.min(baseRiskScore, 15)
    }
    
    const riskScore = Math.max(0, Math.min(100, baseRiskScore + flagAdjustment))

    // Determine status
    let status: 'safe' | 'warning' | 'danger'
    if (riskScore <= 30) status = 'safe'
    else if (riskScore <= 70) status = 'warning'
    else status = 'danger'

    // Get primary domain info
    const primaryDomainInfo = domainChecks[0] || {
      age: 'Unknown',
      registrar: 'Unknown',
      country: 'Unknown'
    }

    // Generate summary and action
    const summary = aiAnalysis.overallAssessment || 
      `Email analysis completed. Risk score: ${riskScore}%. ${allFlags.length} potential issues detected.`

    let suggestedAction = ''
    if (status === 'safe') {
      suggestedAction = 'This email appears legitimate. Proceed with caution and verify company details independently.'
    } else if (status === 'warning') {
      suggestedAction = 'Exercise caution. Request additional verification, company credentials, and references before proceeding.'
    } else {
      suggestedAction = 'High risk detected. Avoid this sponsor. Do not provide personal information or accept payment terms.'
    }

    const result: VerificationResult = {
      riskScore,
      status,
      flags: allFlags,
      domainInfo: primaryDomainInfo,
      extractedInfo: businessInfo,
      summary,
      suggestedAction
    }

    const response = NextResponse.json(result)
    
    // Add CORS headers for Chrome extension
    response.headers.set('Access-Control-Allow-Origin', '*')
    response.headers.set('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS')
    response.headers.set('Access-Control-Allow-Headers', 'Content-Type, Authorization')
    
    return response

  } catch (error) {
    console.error('Verification error:', error)
    const errorResponse = NextResponse.json(
      { error: 'Internal server error during verification' },
      { status: 500 }
    )
    
    // Add CORS headers to error response too
    errorResponse.headers.set('Access-Control-Allow-Origin', '*')
    errorResponse.headers.set('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS')
    errorResponse.headers.set('Access-Control-Allow-Headers', 'Content-Type, Authorization')
    
    return errorResponse
  }
}

// Handle preflight OPTIONS requests
export async function OPTIONS(request: NextRequest) {
  return new NextResponse(null, {
    status: 200,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    },
  })
} 