import { useState, useEffect } from 'react'
import './App.css'
import { supabase } from './lib/supabase'
import { useNavigate } from 'react-router-dom'

interface Emoji {
  id: number
  hebrew_prompt: string
  english_prompt: string
  image_url: string
  created_at: string
}

interface Profile {
  id: string
  email: string
  credits: number
}

function App() {
  const [prompt, setPrompt] = useState('')
  const [generatedImage, setGeneratedImage] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [currentPrompt, setCurrentPrompt] = useState<string | null>(null)
  const [isBackendHealthy, setIsBackendHealthy] = useState(false)
  const [translatedPrompt, setTranslatedPrompt] = useState<string | null>(null)
  const [savedEmojis, setSavedEmojis] = useState<Emoji[]>([])
  const [profile, setProfile] = useState<Profile | null>(null)
  const navigate = useNavigate()

  const translateToEnglish = async (hebrewText: string) => {
    try {
      const response = await fetch('https://translation.googleapis.com/v3/projects/emoji-gen:translateText', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${import.meta.env.VITE_GOOGLE_TRANSLATE_API_KEY}`
        },
        body: JSON.stringify({
          contents: [hebrewText],
          sourceLanguageCode: 'he',
          targetLanguageCode: 'en',
          mimeType: 'text/plain'
        })
      });

      if (!response.ok) {
        const errorData = await response.json();
        console.error('Translation API error:', errorData);
        throw new Error(`Translation failed: ${response.status} ${response.statusText}`);
      }

      const data = await response.json();
      if (!data.translations || !data.translations[0]) {
        throw new Error('No translation found in response');
      }

      return data.translations[0].translatedText;
    } catch (error) {
      console.error('Translation error:', error);
      // Return the original text if translation fails
      return hebrewText;
    }
  };

  useEffect(() => {
    checkBackendHealth()
  }, [])

  const checkBackendHealth = async () => {
    try {
      console.log('🔍 Frontend: Checking backend health...')
      const response = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/health`, {
        method: 'GET',
        headers: {
          'Accept': 'application/json',
          'Authorization': `Bearer ${import.meta.env.VITE_SUPABASE_ANON_KEY}`
        }
      })
      const data = await response.json()
      console.log('✅ Frontend: Backend health check response:', data)
      setIsBackendHealthy(true)
    } catch (error) {
      console.error('❌ Frontend: Backend health check failed:', error)
      setIsBackendHealthy(false)
    }
  }

  useEffect(() => {
    checkAuth()
  }, [])

  const checkAuth = async () => {
    const { data: { session } } = await supabase.auth.getSession()
    if (!session) {
      navigate('/auth')
      return
    }

    try {
      // Fetch user profile
      const { data: profileData, error } = await supabase
        .from('profiles')
        .select('*')
        .eq('id', session.user.id)
        .single()

      if (error) {
        console.error('Error fetching profile:', error)
        // If profile doesn't exist, create it
        if (error.code === 'PGRST116') {
          const { error: insertError } = await supabase
            .from('profiles')
            .insert([
              { 
                id: session.user.id,
                email: session.user.email,
                credits: 5
              }
            ])
          
          if (insertError) {
            console.error('Error creating profile:', insertError)
            return
          }
          
          // Fetch the newly created profile
          const { data: newProfile } = await supabase
            .from('profiles')
            .select('*')
            .eq('id', session.user.id)
            .single()
            
          setProfile(newProfile)
        }
        return
      }

      setProfile(profileData)
      fetchSavedEmojis()
    } catch (error) {
      console.error('Error in checkAuth:', error)
    }
  }

  const handleSignOut = async () => {
    await supabase.auth.signOut()
    navigate('/auth')
  }

  const updateCredits = async (newCredits: number) => {
    if (!profile) return

    const { error } = await supabase
      .from('profiles')
      .update({ credits: newCredits })
      .eq('id', profile.id)

    if (error) {
      console.error('Error updating credits:', error)
      return
    }

    setProfile({ ...profile, credits: newCredits })
  }

  const fetchSavedEmojis = async () => {
    try {
      const { data, error } = await supabase
        .from('emojis')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(10)

      if (error) throw error
      setSavedEmojis(data || [])
    } catch (error) {
      console.error('Error fetching saved emojis:', error)
    }
  }

  const saveEmoji = async (hebrewPrompt: string, englishPrompt: string, imageUrl: string) => {
    try {
      const { error } = await supabase
        .from('emojis')
        .insert([
          {
            hebrew_prompt: hebrewPrompt,
            english_prompt: englishPrompt,
            image_url: imageUrl
          }
        ])
        .select()

      if (error) throw error
      await fetchSavedEmojis()
    } catch (error) {
      console.error('Error saving emoji:', error)
    }
  }

  const handleGenerate = async () => {
    if (!isBackendHealthy) {
      setError('Backend service is not available. Please try again later.')
      return
    }

    if (!profile || profile.credits <= 0) {
      setError('You have no credits left. Please contact an administrator.')
      return
    }

    setIsLoading(true)
    setError(null)
    setGeneratedImage(null)
    setCurrentPrompt(prompt)
    
    console.log('🚀 Frontend: Starting generation process')
    console.log('Original prompt (Hebrew):', prompt)
    
    try {
      const englishPrompt = await translateToEnglish(prompt)
      setTranslatedPrompt(englishPrompt)
      console.log('Translated prompt (English):', englishPrompt)

      const response = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/generate-emoji`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json',
          'Authorization': `Bearer ${import.meta.env.VITE_SUPABASE_ANON_KEY}`
        },
        body: JSON.stringify({ prompt: englishPrompt }),
      })

      console.log('📥 Frontend: Received response, status:', response.status)
      const data = await response.json()

      if (!response.ok) {
        console.error('❌ Frontend: Backend returned error:', data)
        throw new Error(data.error || 'Failed to generate image')
      }

      console.log('✅ Frontend: Successfully received image URL')
      console.log('Raw response:', data)
      
      if (!data.imageUrl) {
        console.error('❌ Frontend: No image URL in response')
        throw new Error('No image URL received from backend')
      }
      
      const imageUrl = String(data.imageUrl).trim()
      if (!imageUrl.startsWith('http')) {
        console.error('❌ Frontend: Invalid image URL format:', imageUrl)
        throw new Error('Invalid image URL format received from backend')
      }
      
      console.log('Image URL:', imageUrl)
      setGeneratedImage(imageUrl)
      setCurrentPrompt(prompt)

      // Save the generated emoji to Supabase
      await saveEmoji(prompt, englishPrompt, imageUrl)
      
      // Update credits
      await updateCredits(profile.credits - 1)
    } catch (error) {
      console.error('❌ Frontend Error:', error)
      if (error instanceof Error && error.message.includes('Failed to fetch')) {
        setError('Unable to connect to the backend service. Please try again later.')
        setIsBackendHealthy(false)
      } else if (error instanceof Error) {
        setError(error.message)
      } else {
        setError('An unexpected error occurred')
      }
    } finally {
      setIsLoading(false)
      console.log('🏁 Frontend: Generation process completed')
    }
  }

  const handleImageClick = async () => {
    if (!generatedImage) return;
    
    try {
      const response = await fetch(generatedImage);
      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'emoji.png';
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);
    } catch (error) {
      console.error('Error downloading image:', error);
      setError('Failed to download image');
    }
  };

  return (
    <div className="container">
      <div className="header">
        <h1>ייצרן האימוגים</h1>
        {profile && (
          <div className="user-info">
            <div className="user-email">{profile.email}</div>
            <div className="user-credits">Credits: {profile.credits}</div>
          </div>
        )}
        <button onClick={handleSignOut} className="sign-out-button">
          Sign Out
        </button>
      </div>
      {!isBackendHealthy && (
        <div className="error-message">
          ⚠️ Backend server is not available. Please make sure the backend is running.
        </div>
      )}
      <div className="content-container">
        <div className="input-container">
          <input
            type="text"
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            placeholder="תאר את האימוגי שאתה מעוניין ליצור"
            className="prompt-input"
            disabled={isLoading}
          />
          <button 
            onClick={handleGenerate}
            className="generate-button"
            disabled={isLoading}
          >
            {isLoading ? '...' : 'ייצר'}
          </button>
          {error && (
            <div className="error-container">
              <div className="error-message">{error}</div>
            </div>
          )}
        </div>
        <div className="result-container">
          <div className="emoji-display" onClick={handleImageClick}>
            {generatedImage ? (
              <img 
                src={generatedImage} 
                alt="Generated emoji" 
                className="generated-image"
                onError={(e) => {
                  console.error('❌ Image failed to load. URL:', generatedImage)
                  console.error('Error details:', e)
                  setError('Failed to load the generated image')
                }}
              />
            ) : null}
          </div>
          {currentPrompt && (
            <div className="prompt-display">
              <div className="prompt-label">הפקודה שניתנה:</div>
              <div className="prompt-text">{currentPrompt}</div>
              {translatedPrompt && (
                <>
                  <div className="prompt-label">Translated to English:</div>
                  <div className="prompt-text">{translatedPrompt}</div>
                </>
              )}
            </div>
          )}
        </div>
        {savedEmojis.length > 0 && (
          <div className="saved-emojis">
            <h2>Emojis Recently Generated</h2>
            <div className="emoji-grid">
              {savedEmojis.map((emoji) => (
                <div key={emoji.id} className="saved-emoji">
                  <img src={emoji.image_url} alt={emoji.hebrew_prompt} />
                  <div className="emoji-info">
                    <div className="emoji-prompt">{emoji.hebrew_prompt}</div>
                    <div className="emoji-date">
                      {new Date(emoji.created_at).toLocaleDateString()}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

export default App
