const express = require('express');
const cors = require('cors');
const Replicate = require('replicate');
require('dotenv').config();

const app = express();
const port = 3001;

// CORS configuration
const corsOptions = {
  origin: 'http://localhost:5173', // Your frontend URL
  methods: ['GET', 'POST', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Accept'],
  credentials: true,
  optionsSuccessStatus: 200
};

// Middleware
app.use(cors(corsOptions));
app.use(express.json());

// Debug middleware
app.use((req, res, next) => {
  console.log(`[${new Date().toISOString()}] ${req.method} ${req.url}`);
  console.log('Request headers:', req.headers);
  console.log('Request body:', req.body);
  next();
});

// Root endpoint - moved to the top
app.get('/', (req, res) => {
  console.log('🔵 Backend: Root endpoint accessed');
  res.json({ 
    message: 'Emoji Generator API is running',
    endpoints: {
      health: '/health',
      generate: '/api/generate',
      docs: '/docs'
    }
  });
});

// Health check endpoint
app.get('/health', (req, res) => {
  console.log('🔵 Backend: Health check endpoint accessed');
  const healthStatus = {
    status: 'ok',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    environment: process.env.NODE_ENV || 'development',
    services: {
      replicate: {
        status: process.env.REPLICATE_API_TOKEN ? 'connected' : 'disconnected',
        model: 'fofr/sdxl-emoji'
      }
    }
  };
  res.json(healthStatus);
});

const replicate = new Replicate({
  auth: process.env.REPLICATE_API_TOKEN,
});

// Generate endpoint
app.get('/api/generate', (req, res) => {
  console.log('❌ Backend: GET request received for /api/generate - Method not allowed');
  res.status(405).json({ error: 'Method not allowed. Please use POST request.' });
});

app.post('/api/generate', async (req, res) => {
  console.log('🔵 Backend: Received generate request');
  console.log('Request body:', req.body);
  
  try {
    const { prompt } = req.body;
    
    if (!prompt) {
      console.log('❌ Backend: No prompt provided');
      return res.status(400).json({ error: 'Prompt is required' });
    }

    // Add TOK emoji to the prompt
    const modifiedPrompt = `A TOK emoji of a ${prompt}`;
    console.log('📝 Backend: Original prompt:', prompt);
    console.log('✏️ Backend: Modified prompt:', modifiedPrompt);
    console.log('🔄 Backend: Calling Replicate API with prompt:', modifiedPrompt);
    
    const prediction = await replicate.predictions.create({
      version: "dee76b5afde21b0f01ed7925f0665b7e879c50ee718c5f78a9d38e04d523cc5e",
      input: {
        prompt: modifiedPrompt,
        apply_watermark: false
      }
    });

    console.log('📥 Backend: Initial prediction response:');
    console.log('ID:', prediction.id);
    console.log('Status:', prediction.status);
    console.log('Created at:', prediction.created_at);
    console.log('Version:', prediction.version);
    console.log('Input:', prediction.input);
    console.log('Full response:', JSON.stringify(prediction, null, 2));

    if (!prediction) {
      console.log('❌ Backend: No prediction created');
      throw new Error('Failed to create prediction');
    }

    // Poll for completion
    let completedPrediction = await replicate.predictions.get(prediction.id);
    console.log('\n🔄 Backend: Starting polling for completion...');
    
    while (completedPrediction.status !== "succeeded" && completedPrediction.status !== "failed") {
      console.log('⏳ Current status:', completedPrediction.status);
      await new Promise(resolve => setTimeout(resolve, 1000));
      completedPrediction = await replicate.predictions.get(prediction.id);
    }

    console.log('\n✅ Backend: Prediction completed:');
    console.log('Final status:', completedPrediction.status);
    console.log('Output:', completedPrediction.output);
    console.log('Error:', completedPrediction.error);
    console.log('Completed at:', completedPrediction.completed_at);
    console.log('Full completed prediction:', JSON.stringify(completedPrediction, null, 2));

    if (completedPrediction.status === "failed") {
      console.log('❌ Backend: Prediction failed:', completedPrediction.error);
      throw new Error(completedPrediction.error || 'Prediction failed');
    }

    if (!completedPrediction.output || !completedPrediction.output[0]) {
      console.log('❌ Backend: No image URL in completed prediction');
      throw new Error('No image URL in completed prediction');
    }

    const imageUrl = completedPrediction.output[0];
    console.log('\n🖼️ Backend: Final image URL:', imageUrl);

    // Remove background from the image
    console.log('🔄 Backend: Removing background from image...');
    const backgroundRemovalPrediction = await replicate.predictions.create({
      version: "fb8af171cfa1616ddcf1242c093f9c46bcada5ad4cf6f2fbe8b81b330ec5c003",
      input: {
        image: imageUrl
      }
    });

    console.log('📥 Backend: Background removal prediction created:', JSON.stringify(backgroundRemovalPrediction, null, 2));

    // Poll for background removal completion
    let completedBackgroundRemoval = await replicate.predictions.get(backgroundRemovalPrediction.id);
    console.log('\n🔄 Backend: Starting polling for background removal...');
    
    while (completedBackgroundRemoval.status !== "succeeded" && completedBackgroundRemoval.status !== "failed") {
      console.log('⏳ Current status:', completedBackgroundRemoval.status);
      await new Promise(resolve => setTimeout(resolve, 1000));
      completedBackgroundRemoval = await replicate.predictions.get(backgroundRemovalPrediction.id);
    }

    console.log('\n✅ Backend: Background removal completed:');
    console.log('Final status:', completedBackgroundRemoval.status);
    console.log('Output:', completedBackgroundRemoval.output);
    console.log('Error:', completedBackgroundRemoval.error);

    if (completedBackgroundRemoval.status === "failed") {
      console.log('❌ Backend: Background removal failed:', completedBackgroundRemoval.error);
      throw new Error(completedBackgroundRemoval.error || 'Background removal failed');
    }

    if (!completedBackgroundRemoval.output) {
      console.log('❌ Backend: No output after background removal');
      throw new Error('No output after background removal');
    }

    // The output is the URL directly, not in an array
    const finalImageUrl = completedBackgroundRemoval.output;
    console.log('\n🖼️ Backend: Final image URL (background removed):', finalImageUrl);

    res.json({ 
      imageUrl: finalImageUrl,
      predictionInfo: {
        status: completedPrediction.status,
        id: completedPrediction.id,
        createdAt: completedPrediction.created_at,
        completedAt: completedPrediction.completed_at,
        backgroundRemoved: true
      }
    });
  } catch (error) {
    console.error('❌ Backend Error:', error);
    console.error('Error stack:', error.stack);
    res.status(500).json({ 
      error: 'Failed to generate image',
      details: error.message,
      stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
    });
  }
});

// 404 handler for undefined routes
app.use((req, res) => {
  console.log('❌ Backend: 404 - Route not found:', req.method, req.url);
  res.status(404).json({
    error: 'Not Found',
    message: `The route ${req.method} ${req.url} does not exist`,
    availableEndpoints: {
      health: 'GET /health',
      generate: 'POST /api/generate',
      root: 'GET /'
    }
  });
});

// Error handling middleware
app.use((err, req, res, next) => {
  console.error('❌ Backend: Unhandled error:', err);
  res.status(500).json({
    error: 'Internal server error',
    message: err.message,
    stack: process.env.NODE_ENV === 'development' ? err.stack : undefined
  });
});

// Start server
const server = app.listen(port, () => {
  console.log(`🚀 Backend server running on http://localhost:${port}`);
  console.log('Environment:', process.env.NODE_ENV || 'development');
  console.log('Replicate API Token:', process.env.REPLICATE_API_TOKEN ? 'Present' : 'Missing');
  console.log('CORS enabled for:', corsOptions.origin);
});

// Handle server errors
server.on('error', (error) => {
  console.error('❌ Server error:', error);
}); 