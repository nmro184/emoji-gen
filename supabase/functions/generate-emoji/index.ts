// Follow this setup guide to integrate the Deno language server with your editor:
// https://deno.land/manual/getting_started/setup_your_environment
// This enables autocomplete, go to definition, etc.

// Setup type definitions for built-in Supabase Runtime APIs
import "jsr:@supabase/functions-js/edge-runtime.d.ts"
import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { corsHeaders } from '../_shared/cors.ts'
import Replicate from 'npm:replicate@1.0.1'

console.log("Hello from Functions!")

const replicate = new Replicate({
  auth: Deno.env.get('REPLICATE_API_TOKEN'),
})

serve(async (req) => {
  // Handle CORS preflight requests
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const { prompt } = await req.json()

    if (!prompt) {
      return new Response(
        JSON.stringify({ error: 'Prompt is required' }),
        { 
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        }
      )
    }

    const prediction = await replicate.predictions.create({
      version: "dee76b5afde21b0f01ed7925f0665b7e879c50ee718c5f78a9d38e04d523cc5e",
      input: {
        prompt: `A TOK emoji of a ${prompt}`,
        apply_watermark: false
      }
    })

    let completedPrediction = await replicate.predictions.get(prediction.id)
    
    while (completedPrediction.status !== "succeeded" && completedPrediction.status !== "failed") {
      await new Promise(resolve => setTimeout(resolve, 1000))
      completedPrediction = await replicate.predictions.get(prediction.id)
    }

    if (completedPrediction.status === "failed") {
      throw new Error(completedPrediction.error || 'Prediction failed')
    }

    if (!completedPrediction.output || !completedPrediction.output[0]) {
      throw new Error('No image URL in prediction output')
    }

    // Remove background from the generated image
    const imageUrl = completedPrediction.output[0]
    console.log('Starting background removal for image:', imageUrl)
    
    const backgroundRemovalPrediction = await replicate.predictions.create({
      version: "fb8af171cfa1616ddcf1242c093f9c46bcada5ad4cf6f2fbe8b81b330ec5c003",
      input: {
        image: imageUrl
      }
    })

    let completedBackgroundRemoval = await replicate.predictions.get(backgroundRemovalPrediction.id)
    
    while (completedBackgroundRemoval.status !== "succeeded" && completedBackgroundRemoval.status !== "failed") {
      await new Promise(resolve => setTimeout(resolve, 1000))
      completedBackgroundRemoval = await replicate.predictions.get(backgroundRemovalPrediction.id)
    }

    if (completedBackgroundRemoval.status === "failed") {
      throw new Error(completedBackgroundRemoval.error || 'Background removal failed')
    }

    if (!completedBackgroundRemoval.output) {
      throw new Error('No output after background removal')
    }

    return new Response(
      JSON.stringify({ imageUrl: completedBackgroundRemoval.output }),
      { 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      }
    )

  } catch (error) {
    return new Response(
      JSON.stringify({ error: error.message }),
      { 
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      }
    )
  }
})

/* To invoke locally:

  1. Run `supabase start` (see: https://supabase.com/docs/reference/cli/supabase-start)
  2. Make an HTTP request:

  curl -i --location --request POST 'http://127.0.0.1:54321/functions/v1/generate-emoji' \
    --header 'Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0' \
    --header 'Content-Type: application/json' \
    --data '{"name":"Functions"}'

*/
