from subconscious import Subconscious
import os
import json
import dotenv
from pydantic import BaseModel

dotenv.load_dotenv()

client = Subconscious(api_key=os.getenv("SUBCONSCIOUS_API_KEY"))

class SentimentAnalysis(BaseModel):
    sentiment: str
    confidence: float
    keywords: list[str]
    
    
def analyze_sentiment(text: str) -> SentimentAnalysis:
    run = client.run(
        engine="tim-gpt",
        input={
            "instructions": f"Analyze the sentiment of the following text: '{text}'",
            "tools": [
                {"type": "platform", "id": "web_search"}
            ],
            "answerFormat": SentimentAnalysis,
        },
        options={"await_completion": True},
    )

    return run.result.answer
    
def main():
    user_input = input("Enter a text to analyze: ")
    result = analyze_sentiment(user_input)
    print(f"Sentiment: {result['sentiment']}")
    print(f"Confidence: {result['confidence']}")
    print(f"Keywords: {result['keywords']}")

if __name__ == "__main__":
    main()