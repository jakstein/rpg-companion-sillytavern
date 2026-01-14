/**
 * Map Prompts Module
 * Handles prompt building and response parsing for location maps
 */

import { extensionSettings, committedTrackerData, lastGeneratedData } from '../../core/state.js';
import { getContext } from '../../../../../../extensions.js';

/**
 * Default prompt for generating regional/outdoor maps
 */
export const DEFAULT_REGIONAL_MAP_PROMPT = `You are a location designer. Generate a regional map layout for the following location.

LOCATION: {{locationName}}
{{#if description}}DESCRIPTION: {{description}}{{/if}}
{{#if extraInstructions}}ADDITIONAL INSTRUCTIONS: {{extraInstructions}}{{/if}}

Generate a JSON object with the following structure:
{
    "layout": {
        "gridSize": { "rows": 5, "cols": 5 },
        "corridors": [
            { "row": 2, "col": 0 },
            { "row": 2, "col": 1 }
        ]
    },
    "rooms": [
        {
            "id": "unique_id",
            "name": "Location Name",
            "roomType": "street|plaza|market|shop|tavern|temple|smithy|stable|garden",
            "description": "Brief description of this area",
            "position": { "row": 0, "col": 0 },
            "exits": [
                { "direction": "north", "destination": "Another Location" }
            ],
            "furniture": [
                { "name": "Item name", "description": "Brief description" }
            ]
        }
    ]
}

GUIDELINES:
- Create 5-10 interesting locations appropriate for the setting
- Place rooms on the grid with logical spatial relationships
- Use corridors (streets/paths) to connect areas
- Include varied room types: shops, taverns, temples, homes, etc.
- Each room should have a unique ID and meaningful description
- Add 2-4 furniture/objects per room that fit the location
- Exits should reference other rooms by name
- Keep grid size reasonable (5x5 to 7x7)

Respond ONLY with the JSON object, no additional text.`;

/**
 * Default prompt for generating interior/location maps
 */
export const DEFAULT_LOCATION_MAP_PROMPT = `You are a location designer. Generate an interior layout for the following building/location.

LOCATION: {{locationName}}
{{#if description}}DESCRIPTION: {{description}}{{/if}}
{{#if extraInstructions}}ADDITIONAL INSTRUCTIONS: {{extraInstructions}}{{/if}}

Generate a JSON object with the following structure:
{
    "layout": {
        "gridSize": { "rows": 5, "cols": 5 },
        "corridors": [
            { "row": 2, "col": 0 },
            { "row": 2, "col": 1 }
        ]
    },
    "rooms": [
        {
            "id": "unique_id",
            "name": "Room Name",
            "roomType": "entrance|bedroom|kitchen|bathroom|living|dining|storage|office|library|corridor",
            "description": "Brief description of this room",
            "position": { "row": 0, "col": 0 },
            "exits": [
                { "direction": "east", "destination": "Kitchen" }
            ],
            "furniture": [
                { "name": "Item name", "description": "Brief description" }
            ]
        }
    ]
}

GUIDELINES:
- Create a realistic interior layout for the building type
- Always include an "entrance" room type as the main entry point
- Place rooms logically (kitchen near dining, bedrooms clustered, etc.)
- Use corridors to connect distant rooms
- Include 4-8 rooms depending on building size
- Each room should have unique ID, name, type, and description
- Add 3-6 furniture/objects per room appropriate to its function
- Exits should reference connected rooms by name
- Consider the setting and time period for furniture choices

Respond ONLY with the JSON object, no additional text.`;

/**
 * Default prompt for generating room furniture
 */
export const DEFAULT_FURNITURE_PROMPT = `Generate a list of furniture and objects for the following room.

ROOM: {{roomName}}
TYPE: {{roomType}}
{{#if description}}CURRENT DESCRIPTION: {{description}}{{/if}}

Generate a JSON object with the following structure:
{
    "furniture": [
        {
            "name": "Object name",
            "description": "Brief description of the object, what it looks like, any notable features"
        }
    ]
}

GUIDELINES:
- Include 4-8 appropriate items for the room type
- Consider the setting and era (medieval, modern, fantasy, etc.)
- Include both large furniture and smaller decorative items
- Add interactive or interesting objects when appropriate
- Make descriptions evocative but concise

Respond ONLY with the JSON object, no additional text.`;

/**
 * Builds a prompt for regional map generation
 * @param {string} locationName - Name of the location
 * @param {string} description - Optional description
 * @param {string} extraInstructions - Optional extra instructions
 * @returns {string} Complete prompt
 */
export function buildRegionalMapPrompt(locationName, description = '', extraInstructions = '') {
    // Get custom prompt or use default
    let prompt = extensionSettings.mapSettings?.customRegionalMapPrompt || DEFAULT_REGIONAL_MAP_PROMPT;

    // Get context for any additional info
    const context = getContext();
    const infoBox = lastGeneratedData.infoBox || committedTrackerData.infoBox;

    // Replace placeholders
    prompt = prompt.replace(/\{\{locationName\}\}/g, locationName);
    prompt = prompt.replace(/\{\{#if description\}\}([\s\S]*?)\{\{\/if\}\}/g, description ? '$1' : '');
    prompt = prompt.replace(/\{\{description\}\}/g, description);
    prompt = prompt.replace(/\{\{#if extraInstructions\}\}([\s\S]*?)\{\{\/if\}\}/g, extraInstructions ? '$1' : '');
    prompt = prompt.replace(/\{\{extraInstructions\}\}/g, extraInstructions);

    // Add context from info box if available
    if (infoBox) {
        let contextInfo = '\n\nCONTEXT FROM STORY:';
        if (infoBox.location?.value) {
            contextInfo += `\nCurrent location in story: ${infoBox.location.value}`;
        }
        if (infoBox.weather?.forecast) {
            contextInfo += `\nWeather: ${infoBox.weather.forecast}`;
        }
        if (infoBox.time?.start) {
            contextInfo += `\nTime: ${infoBox.time.start}`;
        }
        prompt += contextInfo;
    }

    return prompt;
}

/**
 * Builds a prompt for location/interior map generation
 * @param {string} locationName - Name of the location
 * @param {string} description - Optional description
 * @param {string} extraInstructions - Optional extra instructions
 * @returns {string} Complete prompt
 */
export function buildLocationMapPrompt(locationName, description = '', extraInstructions = '') {
    // Get custom prompt or use default
    let prompt = extensionSettings.mapSettings?.customLocationMapPrompt || DEFAULT_LOCATION_MAP_PROMPT;

    // Get context for any additional info
    const context = getContext();
    const infoBox = lastGeneratedData.infoBox || committedTrackerData.infoBox;

    // Replace placeholders
    prompt = prompt.replace(/\{\{locationName\}\}/g, locationName);
    prompt = prompt.replace(/\{\{#if description\}\}([\s\S]*?)\{\{\/if\}\}/g, description ? '$1' : '');
    prompt = prompt.replace(/\{\{description\}\}/g, description);
    prompt = prompt.replace(/\{\{#if extraInstructions\}\}([\s\S]*?)\{\{\/if\}\}/g, extraInstructions ? '$1' : '');
    prompt = prompt.replace(/\{\{extraInstructions\}\}/g, extraInstructions);

    // Add context from info box if available
    if (infoBox) {
        let contextInfo = '\n\nCONTEXT FROM STORY:';
        if (infoBox.location?.value) {
            contextInfo += `\nCurrent location in story: ${infoBox.location.value}`;
        }
        prompt += contextInfo;
    }

    return prompt;
}

/**
 * Builds a prompt for furniture generation
 * @param {string} roomName - Name of the room
 * @param {string} roomType - Type of room
 * @param {string} description - Optional current description
 * @returns {string} Complete prompt
 */
export function buildFurniturePrompt(roomName, roomType = 'default', description = '') {
    // Get custom prompt or use default
    let prompt = extensionSettings.mapSettings?.customFurniturePrompt || DEFAULT_FURNITURE_PROMPT;

    // Replace placeholders
    prompt = prompt.replace(/\{\{roomName\}\}/g, roomName);
    prompt = prompt.replace(/\{\{roomType\}\}/g, roomType);
    prompt = prompt.replace(/\{\{#if description\}\}([\s\S]*?)\{\{\/if\}\}/g, description ? '$1' : '');
    prompt = prompt.replace(/\{\{description\}\}/g, description);

    return prompt;
}

/**
 * Parses map JSON from LLM response
 * @param {string} response - Raw LLM response
 * @returns {Object|null} Parsed map data or null if invalid
 */
export function parseMapJSON(response) {
    try {
        // Try to extract JSON from the response
        let jsonStr = response;

        // Look for JSON in code blocks
        const codeBlockMatch = response.match(/```(?:json)?\s*([\s\S]*?)```/);
        if (codeBlockMatch) {
            jsonStr = codeBlockMatch[1].trim();
        }

        // Try to find JSON object boundaries
        const jsonMatch = response.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
            jsonStr = jsonMatch[0];
        }

        // Parse the JSON
        const data = JSON.parse(jsonStr);

        // Validate basic structure
        if (!data.rooms || !Array.isArray(data.rooms)) {
            console.error('[RPG Companion] Invalid map JSON: missing rooms array');
            return null;
        }

        // Ensure each room has required fields
        data.rooms = data.rooms.map((room, index) => {
            return {
                id: room.id || `room_${index}`,
                name: room.name || `Room ${index + 1}`,
                roomType: room.roomType || 'default',
                description: room.description || '',
                position: room.position || { row: Math.floor(index / 5), col: index % 5 },
                exits: room.exits || [],
                furniture: room.furniture || []
            };
        });

        // Ensure layout exists
        if (!data.layout) {
            data.layout = {
                gridSize: { rows: 5, cols: 5 },
                corridors: []
            };
        }

        return data;

    } catch (error) {
        console.error('[RPG Companion] Failed to parse map JSON:', error);
        console.error('[RPG Companion] Raw response:', response);

        // Try to repair common JSON issues
        try {
            const repairedResponse = repairMapJSON(response);
            if (repairedResponse) {
                return JSON.parse(repairedResponse);
            }
        } catch (repairError) {
            console.error('[RPG Companion] JSON repair also failed:', repairError);
        }

        return null;
    }
}

/**
 * Attempts to repair common JSON issues in LLM responses
 * @param {string} response - Raw response
 * @returns {string|null} Repaired JSON string or null
 */
function repairMapJSON(response) {
    let json = response;

    // Remove any text before first {
    const firstBrace = json.indexOf('{');
    if (firstBrace > 0) {
        json = json.substring(firstBrace);
    }

    // Remove any text after last }
    const lastBrace = json.lastIndexOf('}');
    if (lastBrace >= 0 && lastBrace < json.length - 1) {
        json = json.substring(0, lastBrace + 1);
    }

    // Fix trailing commas in arrays
    json = json.replace(/,(\s*[\]\}])/g, '$1');

    // Fix missing quotes on keys
    json = json.replace(/(\{|\,)\s*(\w+)\s*:/g, '$1"$2":');

    // Try to parse
    return json;
}

/**
 * Builds location context for prompt injection
 * @param {Object} mapData - Current map data
 * @param {string} characterName - Character to get context for
 * @returns {string} Location context string
 */
export function buildLocationContextForInjection(mapData, characterName) {
    if (!mapData || !mapData.maps || mapData.maps.length === 0) {
        return '';
    }

    const locations = mapData.characterLocations || {};
    const charLocation = locations[characterName];

    if (!charLocation) {
        return '';
    }

    const map = mapData.maps.find(m => m.id === charLocation.mapId);
    if (!map) {
        return '';
    }

    const room = map.rooms?.find(r => r.id === charLocation.roomId);
    if (!room) {
        return '';
    }

    // Build context based on settings
    const depth = extensionSettings.mapSettings?.locationContextDepth || 'current_only';

    let context = `[Location: ${map.name} - ${room.name}]\n`;
    context += `${room.description}\n`;

    if (room.furniture && room.furniture.length > 0) {
        context += 'Present in the room: ';
        context += room.furniture.map(f => f.name).join(', ');
        context += '.\n';
    }

    // Get other characters in the same room
    const othersHere = [];
    for (const [name, loc] of Object.entries(locations)) {
        if (name !== characterName && loc.mapId === charLocation.mapId && loc.roomId === charLocation.roomId) {
            othersHere.push(name);
        }
    }

    if (othersHere.length > 0) {
        context += `Also present: ${othersHere.join(', ')}.\n`;
    }

    // Include adjacent rooms if depth allows
    if (depth === 'adjacent_rooms' || depth === 'full_building') {
        if (room.exits && room.exits.length > 0) {
            context += 'Exits: ';
            context += room.exits.map(e => `${e.direction} to ${e.destination}`).join(', ');
            context += '.\n';
        }
    }

    // Include full building if depth is full
    if (depth === 'full_building') {
        const otherRooms = map.rooms.filter(r => r.id !== room.id);
        if (otherRooms.length > 0) {
            context += 'Other areas in this location: ';
            context += otherRooms.map(r => r.name).join(', ');
            context += '.\n';
        }
    }

    return context;
}
