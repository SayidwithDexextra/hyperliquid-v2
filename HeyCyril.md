Hey Cyril Here is a simple getting started guide to using the smart contracts.

First, you want to ensure that the hardhat-node is running and operational.
    npx hardhat node - (ensure this window is kept open at all times to keep the blockchain operational.)

Second, you want to run the deploy scripts to deploy all our smart contracts and create the markets
    

Third, you want to run the @interactive-trader.js by running
    node trade.js 

From here you can simply hit H to enter (hack mode).
    U1 LB 2.20 1 20 - 
        (User 1 placing a limit buy for 20 units @ $2.2)  
        (U1 = USER 1)(Limit buy)(Price 2.2)(Mode 1 = Units / Mode 2 =  USDC value. )(Units)

Feel free to create your own market scenarios and save them into the scenarios folder.
    RUN ./scenarios/< Enter your scenario name > 
         Paste this command into the Hack Mode Terminal, exactly where you would place. (U1 LB 2.20 1 20)
            Warning : I have noticed that running all the commands instantly sometimes causes our blockchain to quit,   
            (depends on your WiFi connection) running line-by-line avoids this.

