// src/index.js

const  { parseQuery} = require('./queryParser');
const readCSV = require('./csvReader');


function evaluateCondition(row, clause) {
    let { field, operator, value } = clause;
   
    value = value.replace(/["']/g, '');
    if(row[field])
    row[field] = row[field].replace(/["']/g, '');

    // console.log(row,clause,value)
    switch (operator) {
        case '=':  return row[field] == value;
        case '!=': return row[field] !== value;
        case '>': return row[field] > value;
        case '<': return row[field] < value;
        case '>=': return row[field] >= value;
        case '<=': return row[field] <= value;
        default: throw new Error(`Unsupported operator: ${operator}`);
    }
}

function performInnerJoin(data, joinData, joinCondition, fields, table) {
    // Logic for INNER JOIN
    data = data.flatMap(mainRow => {
        
        return joinData
            .filter(joinRow => {
                const mainValue = mainRow[joinCondition.left.split('.')[1]];
                const joinValue = joinRow[joinCondition.right.split('.')[1]];
                return mainValue === joinValue;
            })
            .map(joinRow => {
                return fields.reduce((acc, field) => {
                    const [tableName, fieldName] = field.split('.');
                    acc[field] = tableName === table ? mainRow[fieldName] : joinRow[fieldName];
                    return acc;
                }, {});
            });
    });
    return data
    // ...
}

function performLeftJoin(data, joinData, joinCondition, fields, table) {
    
    return data.flatMap(mainRow => {
        const matchingJoinRows = joinData.filter(joinRow => {
            const mainValue = getValueFromRow(mainRow, joinCondition.left);
            const joinValue = getValueFromRow(joinRow, joinCondition.right);
            return mainValue === joinValue;
        });

        if (matchingJoinRows.length === 0) {
            return [createResultRow(mainRow, null, fields, table, true)];
        }

        return matchingJoinRows.map(joinRow => createResultRow(mainRow, joinRow, fields, table, true));
    });
}

function getValueFromRow(row, compoundFieldName) {
    const [tableName, fieldName] = compoundFieldName.split('.');
    return row[`${tableName}.${fieldName}`] || row[fieldName];
}

function performRightJoin(data, joinData, joinCondition, fields, table) {
    // Cache the structure of a main table row (keys only)
    const mainTableRowStructure = data.length > 0 ? Object.keys(data[0]).reduce((acc, key) => {
        acc[key] = null; // Set all values to null initially
        return acc;
    }, {}) : {};

    return joinData.map(joinRow => {
        const mainRowMatch = data.find(mainRow => {
            const mainValue = getValueFromRow(mainRow, joinCondition.left);
            const joinValue = getValueFromRow(joinRow, joinCondition.right);
            return mainValue === joinValue;
        });

        // Use the cached structure if no match is found
        const mainRowToUse = mainRowMatch || mainTableRowStructure;

        // Include all necessary fields from the 'student' table
        return createResultRow(mainRowToUse, joinRow, fields, table, true);
    });
}

function createResultRow(mainRow, joinRow, fields, table, includeAllMainFields) {
    const resultRow = {};

    if (includeAllMainFields) {
        // Include all fields from the main table
        Object.keys(mainRow || {}).forEach(key => {
            const prefixedKey = `${table}.${key}`;
            resultRow[prefixedKey] = mainRow ? mainRow[key] : null;
        });
    }

    // Now, add or overwrite with the fields specified in the query
    fields.forEach(field => {
        const [tableName, fieldName] = field.includes('.') ? field.split('.') : [table, field];
        resultRow[field] = tableName === table && mainRow ? mainRow[fieldName] : joinRow ? joinRow[fieldName] : null;
    });

    return resultRow;
}
// Helper function to apply GROUP BY and aggregate functions

function applyGroupBy(data, groupByFields, aggregateFunctions) {
    // Implement logic to group data and calculate aggregates
    const groupResults = {};
    // console.log(groupByFields)
    data.forEach((row) => {
        const groupKey = groupByFields.map(field => row[field]).join('-');
        
        if (!groupResults[groupKey]) {
            groupResults[groupKey] = { count: 0, sums: {}, mins: {}, maxes: {} };
            groupByFields.forEach(field => groupResults[groupKey][field] = row[field]);
        }

        // Aggregate calculations
        groupResults[groupKey].count += 1;
        aggregateFunctions.forEach(func => {
            const match = /(\w+)\((\w+)\)/.exec(func);
            if (match) {
                const [, aggFunc, aggField] = match;
                const value = parseFloat(row[aggField]);

                switch (aggFunc.toUpperCase()) {
                    case 'SUM':
                        groupResults[groupKey].sums[aggField] = (groupResults[groupKey].sums[aggField] || 0) + value;
                        break;
                    case 'MIN':
                        groupResults[groupKey].mins[aggField] = Math.min(groupResults[groupKey].mins[aggField] || value, value);
                        break;
                    case 'MAX':
                        groupResults[groupKey].maxes[aggField] = Math.max(groupResults[groupKey].maxes[aggField] || value, value);
                        break;
                    // Additional aggregate functions can be added here
                }
            }
        });
    });

    // Convert grouped results into an array format
    return Object.values(groupResults).map(group => {
        // Construct the final grouped object based on required fields
        const finalGroup = {};
        groupByFields.forEach(field => finalGroup[field] = group[field]);
        aggregateFunctions.forEach(func => {
            const match = /(\w+)\((\*|\w+)\)/.exec(func);
            if (match) {
                const [, aggFunc, aggField] = match;
                switch (aggFunc.toUpperCase()) {
                    case 'SUM':
                        finalGroup[func] = group.sums[aggField];
                        break;
                    case 'MIN':
                        finalGroup[func] = group.mins[aggField];
                        break;
                    case 'MAX':
                        finalGroup[func] = group.maxes[aggField];
                        break;
                    case 'COUNT':
                        finalGroup[func] = group.count;
                        break;
                    // Additional aggregate functions can be handled here
                }
            }
        });
        console.log(finalGroup)
        return finalGroup;
    });
}


async function executeSELECTQuery(query) {
    const { fields, table, whereClauses, joinType, joinTable, joinCondition, groupByFields,orderByFields, hasAggregateWithoutGroupBy } = parseQuery(query)
   
    let data = await readCSV(`${table}.csv`);
    
    // Perform INNER JOIN if specified
    if (joinTable && joinCondition) {
        const joinData = await readCSV(`${joinTable}.csv`);
        switch (joinType.toUpperCase()) {
            case 'INNER':
                data = performInnerJoin(data, joinData, joinCondition, fields, table);
                break;
            case 'LEFT':
                data = performLeftJoin(data, joinData, joinCondition, fields, table);
                break;
            case 'RIGHT':
                data = performRightJoin(data, joinData, joinCondition, fields, table);
                break;
            // Handle default case or unsupported JOIN types
        }
    }
    
    
    
    // Apply WHERE clause filtering after JOIN (or on the original data if no join)
    
    const filteredData = whereClauses.length > 0
        ? data.filter(row => whereClauses.every(clause => evaluateCondition(row, clause)))
        : data;
    
    
    let groupResults=filteredData
        if (hasAggregateWithoutGroupBy) {
        let result = {}
    fields.forEach(field => {
            const match = /(\w+)\((\*|\w+)\)/.exec(field);
            if (match) {
                const [, aggFunc, aggField] = match;
                switch (aggFunc.toUpperCase()) {
                    case 'COUNT':
                        result[field] = filteredData.length;
                        break;
                    case 'SUM':
                        result[field] = filteredData.reduce((acc, row) => acc + parseFloat(row[aggField]), 0);
                        break;
                    case 'AVG':
                        result[field] = filteredData.reduce((acc, row) => acc + parseFloat(row[aggField]), 0) / filteredData.length;
                        break;
                    case 'MIN':
                        result[field] = Math.min(...filteredData.map(row => parseFloat(row[aggField])));
                        break;
                    case 'MAX':
                        result[field] = Math.max(...filteredData.map(row => parseFloat(row[aggField])));
                        break;
                    // Additional aggregate functions can be handled here
                }
            }
        });
        
        
        if (Object.keys(result).length > 0) {
            return[result]
        }
    }
    else if (groupByFields) {
        groupResults = applyGroupBy(filteredData, groupByFields, fields);

        // Order them by the specified fields
        let orderedResults = groupResults;
        if (orderByFields) {
            orderedResults = groupResults.sort((a, b) => {
                for (let { fieldName, order } of orderByFields) {
                    if (a[fieldName] < b[fieldName]) return order === 'ASC' ? -1 : 1;
                    if (a[fieldName] > b[fieldName]) return order === 'ASC' ? 1 : -1;
                }
                return 0;
            });
        }
        return groupResults;
        } else {

            // Order them by the specified fields
            let orderedResults = groupResults;
            if (orderByFields) {
                orderedResults = groupResults.sort((a, b) => {
                    for (let { fieldName, order } of orderByFields) {
                        if (a[fieldName] < b[fieldName]) return order === 'ASC' ? -1 : 1;
                        if (a[fieldName] > b[fieldName]) return order === 'ASC' ? 1 : -1;
                    }
                    return 0;
                });
            }
    
            // Select the specified fields
            return orderedResults.map(row => {
                const selectedRow = {};
                fields.forEach(field => {
                    // Assuming 'field' is just the column name without table prefix
                    selectedRow[field] = row[field];
                });
                return selectedRow;
            });
        }
    }


module.exports = executeSELECTQuery;