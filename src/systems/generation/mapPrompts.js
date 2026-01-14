/**
 * Map Prompts Module
 * Handles prompt building, response parsing, and layout solving for location maps
 * Simplified format: LLM only provides room names, sizes, connections, and furniture names
 * Layout positioning is handled programmatically by the solver
 */

import { extensionSettings, committedTrackerData, lastGeneratedData } from '../../core/state.js';
import { getContext } from '../../../../../../extensions.js';

/**
 * Default prompt for generating regional/outdoor maps (simplified)
 */
export const DEFAULT_REGIONAL_MAP_PROMPT = `Generate locations for: {{locationName}}
{{#if description}}({{description}}){{/if}}
{{#if extraInstructions}}{{extraInstructions}}{{/if}}

Output ONLY this JSON format:
{"rooms":[{"name":"Place Name","size":"4x4","exits":["Connected Place"],"furniture":["object1","object2"]}]}

- 5-8 locations for the setting
- size: "WxH" meters (e.g. "4x6")
- exits: connected location names
- furniture: 2-4 object names
- All exit names must match a room name`;

/**
 * Default prompt for generating interior/location maps (simplified)
 */
export const DEFAULT_LOCATION_MAP_PROMPT = `Generate rooms for: {{locationName}}
{{#if description}}({{description}}){{/if}}
{{#if extraInstructions}}{{extraInstructions}}{{/if}}

Output ONLY this JSON format:
{"rooms":[{"name":"Room Name","size":"3x4","exits":["Connected Room"],"furniture":["item1","item2"]}]}

- Include "Entrance" room
- 4-8 rooms, logical connections
- size: "WxH" meters (e.g. "3x4")
- exits: connected room names
- furniture: 3-5 object names
- All exit names must match a room name`;

/**
 * Default prompt for generating room furniture (simplified)
 */
export const DEFAULT_FURNITURE_PROMPT = `List objects in: {{roomName}}

Output ONLY: {"furniture":["item1","item2","item3"]}

4-8 appropriate items for the setting.`;

/**
 * Parses room size string like "3x4" into width and height
 */
function parseRoomSize(sizeStr) {
    const match = sizeStr?.match(/(\d+)\s*x\s*(\d+)/i);
    if (match) {
        return { width: parseInt(match[1]), height: parseInt(match[2]) };
    }
    return { width: 2, height: 2 };
}

/**
 * Layout solver - places rooms around a central corridor programmatically
 * @param {Array} rooms - Array of room objects from LLM
 * @returns {Object} Complete layout with grid and positioned rooms
 */
export function solveRoomLayout(rooms) {
    if (!rooms || rooms.length === 0) {
        return { layout: { gridSize: { rows: 5, cols: 5 }, corridors: [] }, rooms: [] };
    }

    // Normalize and parse room data
    const roomData = rooms.map((room, index) => ({
        id: `room_${index}`,
        name: room.name || `Room ${index + 1}`,
        size: room.size || '3x3',
        parsedSize: parseRoomSize(room.size),
        connections: Array.isArray(room.exits) ? room.exits : [],
        furniture: Array.isArray(room.furniture) ? room.furniture : [],
        placed: false,
        position: null
    }));

    // Find entrance as starting point
    const entranceIndex = roomData.findIndex(r => 
        r.name.toLowerCase().includes('entrance') || 
        r.name.toLowerCase().includes('entry') ||
        r.name.toLowerCase().includes('front')
    );
    const startIndex = entranceIndex >= 0 ? entranceIndex : 0;

    // Calculate grid size
    const totalArea = roomData.reduce((sum, r) => sum + (r.parsedSize.width * r.parsedSize.height), 0);
    const gridDimension = Math.max(7, Math.ceil(Math.sqrt(totalArea * 1.5)));
    
    // Central corridor
    const corridorRow = Math.floor(gridDimension / 2);
    const corridors = [];
    for (let col = 1; col < gridDimension - 1; col++) {
        corridors.push({ row: corridorRow, col });
    }

    // Generate placement slots above and below corridor
    const slots = [];
    for (let col = 1; col < gridDimension - 2; col += 2) {
        slots.push({ row: corridorRow - 2, col, side: 'above' });
        slots.push({ row: corridorRow + 2, col, side: 'below' });
    }

    // Place rooms using BFS from entrance
    const queue = [startIndex];
    const visited = new Set();
    let slotIdx = 0;

    while (queue.length > 0 && slotIdx < slots.length) {
        const idx = queue.shift();
        if (visited.has(idx)) continue;
        visited.add(idx);

        const room = roomData[idx];
        if (room.placed) continue;

        const slot = slots[slotIdx];
        room.position = { row: slot.row, col: slot.col };
        room.placed = true;
        slotIdx++;

        // Queue connected rooms
        for (const exitName of room.connections) {
            const connIdx = roomData.findIndex(r => 
                r.name.toLowerCase() === exitName.toLowerCase()
            );
            if (connIdx >= 0 && !visited.has(connIdx)) {
                queue.push(connIdx);
            }
        }
    }

    // Place remaining unplaced rooms
    for (const room of roomData) {
        if (!room.placed && slotIdx < slots.length) {
            room.position = { row: slots[slotIdx].row, col: slots[slotIdx].col };
            room.placed = true;
            slotIdx++;
        } else if (!room.placed) {
            room.position = { row: 0, col: slotIdx % gridDimension };
        }
    }

    // Build final rooms with exits converted to direction format
    const finalRooms = roomData.map(room => {
        const exits = room.connections.map(exitName => {
            const target = roomData.find(r => r.name.toLowerCase() === exitName.toLowerCase());
            let direction = 'corridor';
            if (target?.position && room.position) {
                const rowDiff = target.position.row - room.position.row;
                const colDiff = target.position.col - room.position.col;
                if (Math.abs(rowDiff) > Math.abs(colDiff)) {
                    direction = rowDiff > 0 ? 'south' : 'north';
                } else if (colDiff !== 0) {
                    direction = colDiff > 0 ? 'east' : 'west';
                }
            }
            return { direction, destination: exitName };
        });

        const furniture = room.furniture.map(item => 
            typeof item === 'string' ? { name: item } : item
        );

        return {
            id: room.id,
            name: room.name,
            size: room.size,
            description: '',
            position: room.position,
            exits,
            furniture
        };
    });

    return {
        layout: { gridSize: { rows: gridDimension, cols: gridDimension }, corridors },
        rooms: finalRooms
    };
}

/**
 * Builds a quiet prompt for map generation (uses generateQuietPrompt for full context)
 */
export function buildMapQuietPrompt(locationName, description = '', extraInstructions = '', mapType = 'location') {
    const isRegional = mapType === 'regional';
    let template = isRegional 
        ? (extensionSettings.mapSettings?.customRegionalMapPrompt || DEFAULT_REGIONAL_MAP_PROMPT)
        : (extensionSettings.mapSettings?.customLocationMapPrompt || DEFAULT_LOCATION_MAP_PROMPT);

    template = template.replace(/\{\{locationName\}\}/g, locationName);
    template = template.replace(/\{\{#if description\}\}([\s\S]*?)\{\{\/if\}\}/g, description ? '$1' : '');
    template = template.replace(/\{\{description\}\}/g, description);
    template = template.replace(/\{\{#if extraInstructions\}\}([\s\S]*?)\{\{\/if\}\}/g, extraInstructions ? '$1' : '');
    template = template.replace(/\{\{extraInstructions\}\}/g, extraInstructions);

    return template;
}

/**
 * Builds a quiet prompt for furniture generation
 */
export function buildFurnitureQuietPrompt(roomName) {
    let template = extensionSettings.mapSettings?.customFurniturePrompt || DEFAULT_FURNITURE_PROMPT;
    return template.replace(/\{\{roomName\}\}/g, roomName);
}

/**
 * Parses simplified map JSON from LLM response
 */
export function parseMapJSON(response) {
    try {
        let jsonStr = response;

        // Remove thinking tags
        jsonStr = jsonStr.replace(/<think>[\s\S]*?<\/think>/gi, '');
        jsonStr = jsonStr.replace(/<thinking>[\s\S]*?<\/thinking>/gi, '');

        // Extract from code blocks
        const codeBlockMatch = jsonStr.match(/```(?:json)?\s*([\s\S]*?)```/);
        if (codeBlockMatch) jsonStr = codeBlockMatch[1].trim();

        // Find JSON object
        const jsonMatch = jsonStr.match(/\{[\s\S]*\}/);
        if (jsonMatch) jsonStr = jsonMatch[0];

        // Clean common issues
        jsonStr = jsonStr.replace(/,\s*([}\]])/g, '$1');
        jsonStr = jsonStr.replace(/'/g, '"');

        const data = JSON.parse(jsonStr);

        if (!data.rooms || !Array.isArray(data.rooms)) {
            console.error('[RPG Companion] Invalid map JSON: missing rooms array');
            return null;
        }

        // Normalize room data
        data.rooms = data.rooms.map((room, index) => ({
            name: room.name || `Room ${index + 1}`,
            size: room.size || '3x3',
            exits: Array.isArray(room.exits) ? room.exits : [],
            furniture: Array.isArray(room.furniture) ? room.furniture : []
        }));

        return data;
    } catch (error) {
        console.error('[RPG Companion] Failed to parse map JSON:', error, response);
        return null;
    }
}

/**
 * Parses furniture JSON from LLM response
 */
export function parseFurnitureJSON(response) {
    try {
        let jsonStr = response;
        jsonStr = jsonStr.replace(/<think>[\s\S]*?<\/think>/gi, '');
        jsonStr = jsonStr.replace(/<thinking>[\s\S]*?<\/thinking>/gi, '');

        const codeBlockMatch = jsonStr.match(/```(?:json)?\s*([\s\S]*?)```/);
        if (codeBlockMatch) jsonStr = codeBlockMatch[1].trim();

        const jsonMatch = jsonStr.match(/\{[\s\S]*\}/);
        if (jsonMatch) jsonStr = jsonMatch[0];

        jsonStr = jsonStr.replace(/,\s*([}\]])/g, '$1');
        jsonStr = jsonStr.replace(/'/g, '"');

        const data = JSON.parse(jsonStr);
        if (data.furniture && Array.isArray(data.furniture)) {
            return data.furniture.map(item => 
                typeof item === 'string' ? { name: item } : { name: item.name || 'Unknown' }
            );
        }
        return null;
    } catch (error) {
        console.error('[RPG Companion] Failed to parse furniture JSON:', error);
        return null;
    }
}

/**
 * Builds location context for prompt injection
 */
export function buildLocationContextForInjection(mapData, characterName) {
    if (!mapData?.maps?.length) return '';

    const charLocation = mapData.characterLocations?.[characterName];
    if (!charLocation) return '';

    const map = mapData.maps.find(m => m.id === charLocation.mapId);
    const room = map?.rooms?.find(r => r.id === charLocation.roomId);
    if (!room) return '';

    let context = `[Location: ${map.name} - ${room.name}]\n`;

    if (room.furniture?.length) {
        const names = room.furniture.map(f => typeof f === 'string' ? f : f.name);
        context += `Objects: ${names.join(', ')}.\n`;
    }

    const othersHere = Object.entries(mapData.characterLocations || {})
        .filter(([name, loc]) => name !== characterName && loc.mapId === charLocation.mapId && loc.roomId === charLocation.roomId)
        .map(([name]) => name);

    if (othersHere.length) context += `Present: ${othersHere.join(', ')}.\n`;

    if (room.exits?.length) {
        context += `Exits: ${room.exits.map(e => e.destination || e).join(', ')}.\n`;
    }

    return context;
}
