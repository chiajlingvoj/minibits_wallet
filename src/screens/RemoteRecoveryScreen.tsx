import {observer} from 'mobx-react-lite'
import React, {FC, useEffect, useRef, useState} from 'react'
import {LayoutAnimation, Platform, Switch, TextInput, TextStyle, UIManager, View, ViewStyle} from 'react-native'
import {validateMnemonic} from '@scure/bip39'
import { wordlist } from '@scure/bip39/wordlists/english'
import {colors, spacing, useThemeColor} from '../theme'
import {AppStackScreenProps} from '../navigation' // @demo remove-current-line
import {
  Icon,
  ListItem,
  Screen,
  Text,
  Card,
  Loading,
  ErrorModal,
  InfoModal,
  BottomModal,
  Button,
  $sizeStyles,
} from '../components'
import {useHeader} from '../utils/useHeader'
import AppError, { Err } from '../utils/AppError'
import { KeyChain, log, MinibitsClient, MintClient, MintKeys, NostrClient } from '../services'
import Clipboard from '@react-native-clipboard/clipboard'
import { useStores } from '../models'
import { MintListItem } from './Mints/MintListItem'
import { Mint } from '../models/Mint'
import { CashuMint, deriveKeysetId } from '@cashu/cashu-ts'
import { CashuUtils } from '../services/cashu/cashuUtils'
import { Proof } from '../models/Proof'
import {
    type Proof as CashuProof,
} from '@cashu/cashu-ts'
import { Transaction, TransactionData, TransactionRecord, TransactionStatus, TransactionType } from '../models/Transaction'
import { ResultModalInfo } from './Wallet/ResultModalInfo'
import { deriveSeedFromMnemonic } from '@cashu/cashu-ts'
import { MINIBITS_NIP05_DOMAIN } from '@env'
import { delay } from '../utils/utils'

if (Platform.OS === 'android' &&
    UIManager.setLayoutAnimationEnabledExperimental) {
    UIManager.setLayoutAnimationEnabledExperimental(true)
}

const RESTORE_INDEX_INTERVAL = 50

export const RemoteRecoveryScreen: FC<AppStackScreenProps<'RemoteRecovery'>> = observer(function RemoteRecoveryScreen(_props) {
    const {navigation, route} = _props    
    useHeader({
        leftIcon: 'faArrowLeft',
        onLeftPress: () => {            
            navigation.goBack()
        },
    })

    const {mintsStore, proofsStore, userSettingsStore, transactionsStore, walletProfileStore} = useStores()
    const mnemonicInputRef = useRef<TextInput>(null)

    const [info, setInfo] = useState('')
    const [mnemonic, setMnemonic] = useState<string>('')        
    const [mnemonicExists, setMnemonicExists] = useState(false)
    const [isValidMnemonic, setIsValidMnemonic] = useState(false)
    const [seed, setSeed] = useState<Uint8Array>()
    const [startIndex, setStartIndex] = useState<number>(0) // start of interval of indexes of proofs to recover
    const [endIndex, setEndIndex] = useState<number>(RESTORE_INDEX_INTERVAL) // end of interval
    const [isLoading, setIsLoading] = useState(false)
    const [error, setError] = useState<AppError | undefined>()
    const [isErrorsModalVisible, setIsErrorsModalVisible] = useState(false)
    const [resultModalInfo, setResultModalInfo] = useState<{status: TransactionStatus, message: string} | undefined>()
    const [isResultModalVisible, setIsResultModalVisible] = useState(false)
    const [lastRecoveredAmount, setLastRecoveredAmount] = useState<number>(0)
    const [recoveryErrors, setRecoveryErrors] = useState<AppError[]>([])
    const [statusMessage, setStatusMessage] = useState<string>()

    useEffect(() => {
        const getMnemonic = async () => {  
            try {
                setIsLoading(true)          
                const existing = await MintClient.getMnemonic()

                if(existing) {
                    setMnemonicExists(true)
                }
                setIsLoading(false) 
            } catch (e: any) {
                handleError(e)
            } 
        }
        getMnemonic()
    }, [])


    const toggleResultModal = () => {
        if(isResultModalVisible === true) {
            setResultModalInfo(undefined)
        }
        setIsResultModalVisible(previousState => !previousState)        
    }


    const toggleErrorsModal = () => {
        setIsErrorsModalVisible(previousState => !previousState)
    }


    const onPaste = async function () {
        try {
            const maybeMnemonic = await Clipboard.getString()

            if(!maybeMnemonic) {
                throw new AppError(Err.VALIDATION_ERROR, 'Missing mnemonic phrase.')
            }

            const cleanedMnemonic = maybeMnemonic.replace(/\s+/g, ' ').trim()

            setMnemonic(cleanedMnemonic)
        } catch (e: any) {
            handleError(e)
        }
    }


    const onConfirm = async function () {
        try {
            setStatusMessage('Deriving seed, this takes a while...')
            
            if(!mnemonic) {
                throw new AppError(Err.VALIDATION_ERROR, 'Missing mnemonic.')
            }
            LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut)
            setIsLoading(true)

            if (!validateMnemonic(mnemonic, wordlist)) {
                throw new AppError(Err.VALIDATION_ERROR, 'Invalid mnemonic phrase. Provide 12 words sequence separated by blank spaces.')
            }          

            setTimeout(() => {                                
                const binarySeed = deriveSeedFromMnemonic(mnemonic) // expensive
                setSeed(binarySeed)
                setIsValidMnemonic(true)
                LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut)
                setIsLoading(false)
            }, 200)
        } catch (e: any) {
            handleError(e)
        }
    }

    const onBack = function (): void {
        return navigation.goBack()
    }


    const onAddMints = function (): void {
        return navigation.navigate('Mints')
    }


    const startRecovery = async function () {
        setStatusMessage('Starting recovery...')
        setIsLoading(true)        
        setTimeout(() => doRecovery(), 200)        
    }

    const doRecovery = async function () {        
        let errors: AppError[] = []
        let recoveredAmount: number = 0
        let alreadySpentAmount: number = 0
        
        setStatusMessage('Loading mints...')
        
        for (const mint of mintsStore.allMints) {            
            const transactionData: TransactionData[] = []            
            let transactionId: number = 0

            const pendingTransactionData: TransactionData[] = []
            let pendingTransactionId: number = 0

            try {
                // TODO allow input or get previous keysets from mint and try to restore from them
                setStatusMessage(`Restoring from ${mint.hostname}...`)
                log.info('[restore]', `Restoring from ${mint.hostname}...`)
                
                const { proofs, newKeys } = await MintClient.restore(
                    mint.mintUrl, 
                    startIndex, 
                    endIndex,
                    seed as Uint8Array
                )

                log.debug('[restore]', `Restored proofs`, proofs.length)                
                setStatusMessage(`Found ${proofs.length} proofs...`)

                // exit if nothing recovered
                if (proofs.length === 0) {
                    continue
                }

                // need to move counter by whole interval to avoid duplicate _B!!!
                mint.increaseProofsCounter(Math.abs(endIndex - startIndex))
                
                if(newKeys) {updateMintKeys(mint.mintUrl as string, newKeys)}
                
                const {spent, pending} = await MintClient.getSpentOrPendingProofsFromMint(
                    mint.mintUrl,
                    proofs as Proof[]
                )

                log.debug('[restore]', `Spent and pending proofs`, {spent: spent.length, pending: pending.length})

                setStatusMessage(`${spent.length} proofs were already spent...`)

                const spentAmount = CashuUtils.getProofsAmount(spent as Proof[])
                alreadySpentAmount += spentAmount

                const unspent = proofs.filter(proof => !spent.includes(proof))
                
                if(unspent && unspent.length > 0) {
                    
                    setStatusMessage(`Completing recovery...`)

                    const amount = CashuUtils.getProofsAmount(unspent as Proof[])
                    recoveredAmount += amount
                    
                    // Let's create new draft receive transaction in database
                    transactionData.push({
                        status: TransactionStatus.PREPARED,
                        amount,
                        createdAt: new Date(),
                    })

                    const newTransaction: Transaction = {
                        type: TransactionType.RECEIVE,
                        amount,
                        data: JSON.stringify(transactionData),
                        memo: 'Wallet recovery',
                        mint: mint.mintUrl,
                        status: TransactionStatus.PREPARED,
                    }

                    const draftTransaction: TransactionRecord = await transactionsStore.addTransaction(newTransaction)
                    transactionId = draftTransaction.id as number

                    const { amountToAdd, addedAmount } = addCashuProofs(
                        unspent,
                        mint.mintUrl,
                        transactionId as number                
                    )                    

                    if (amountToAdd !== addedAmount) {
                        await transactionsStore.updateReceivedAmount(
                            transactionId as number,
                            addedAmount,
                        )

                        recoveredAmount = recoveredAmount - amount + addedAmount
                    }

                    // Finally, update completed transaction
                    transactionData.push({
                        status: TransactionStatus.COMPLETED,                        
                        createdAt: new Date(),
                    })

                    await transactionsStore.updateStatus(
                        transactionId,
                        TransactionStatus.COMPLETED,
                        JSON.stringify(transactionData),
                    )

                    const balanceAfter = proofsStore.getBalances().totalBalance
                    await transactionsStore.updateBalanceAfter(transactionId, balanceAfter)
                }
           
                if(pending && pending.length > 0) {

                    // infoMessage(`Found pending ecash...`)
                    setStatusMessage(`Found ${pending.length} pending proofs...`)
                    log.debug(`Found pending ecash with ${mint.hostname}...`)

                    const amount = CashuUtils.getProofsAmount(pending as Proof[])
                    
                    // Let's create new draft receive transaction in database
                    pendingTransactionData.push({
                        status: TransactionStatus.PREPARED,
                        amount,
                        createdAt: new Date(),
                    })

                    const newTransaction: Transaction = {
                        type: TransactionType.RECEIVE,
                        amount,
                        data: JSON.stringify(transactionData),
                        memo: 'Wallet recovery - pending',
                        mint: mint.mintUrl,
                        status: TransactionStatus.PREPARED,
                    }

                    const draftTransaction: TransactionRecord = await transactionsStore.addTransaction(newTransaction)
                    pendingTransactionId = draftTransaction.id as number

                    const { amountToAdd, addedAmount } = addCashuProofs(
                        pending,
                        mint.mintUrl,
                        pendingTransactionId as number,
                        true  // isPending = true              
                    )

                    if (amountToAdd !== addedAmount) {
                        await transactionsStore.updateReceivedAmount(
                            transactionId as number,
                            addedAmount,
                        )
                    }

                    // Finally, update pending transaction
                    pendingTransactionData.push({
                        status: TransactionStatus.PENDING,                        
                        createdAt: new Date(),
                    })

                    await transactionsStore.updateStatus(
                        pendingTransactionId,
                        TransactionStatus.PENDING,
                        JSON.stringify(pendingTransactionData),
                    )
                }

            } catch(e: any) {
                
                if (mint) {
                    e.params = {mintUrl: mint.mintUrl}
                }

                log.error(e, {mintUrl: mint.mintUrl})
                errors.push(e)

                if (transactionId > 0) {
                    transactionData.push({
                        status: TransactionStatus.ERROR,
                        error: formatError(e),
                        createdAt: new Date(),
                    })
    
                    await transactionsStore.updateStatus(
                        transactionId,
                        TransactionStatus.ERROR,
                        JSON.stringify(transactionData),
                    )
                }

                if (pendingTransactionId > 0) {
                    pendingTransactionData.push({
                        status: TransactionStatus.ERROR,
                        error: formatError(e),
                        createdAt: new Date(),
                    })
    
                    await transactionsStore.updateStatus(
                        pendingTransactionId,
                        TransactionStatus.ERROR,
                        JSON.stringify(pendingTransactionData),
                    )
                }
                setStatusMessage(undefined)
                continue
            }
        }

        setLastRecoveredAmount(recoveredAmount)
        setStartIndex(startIndex + RESTORE_INDEX_INTERVAL)
        setEndIndex(endIndex + RESTORE_INDEX_INTERVAL)       
        setStatusMessage(undefined)
        setIsLoading(false)

        if(recoveredAmount > 0) {
            setResultModalInfo({
                status: TransactionStatus.COMPLETED, 
                message: `${recoveredAmount} sats were recovered into your wallet.`
            })
        } else {
            if(errors.length > 0) {
                setResultModalInfo({
                    status: TransactionStatus.ERROR, 
                    message: `Recovery ended up with errors.`
                })            
                setRecoveryErrors(errors)
            } else {
                if(alreadySpentAmount > 0) {
                    setResultModalInfo({
                        status: TransactionStatus.EXPIRED, 
                        message: `Good news is that already spent ecash has been found. Continue with next recovery interval.`
                    }) 
                } else {
                    setResultModalInfo({
                        status: TransactionStatus.EXPIRED, 
                        message: `Nothing has been found in this recovery interval.`
                    }) 
                }

            }
        }

        toggleResultModal() // open

    }


    // TODO: make it DRY with walletService
    const updateMintKeys = function (mintUrl: string, newKeys: MintKeys) {
        if(!CashuUtils.validateMintKeys(newKeys)) {
            // silent
            log.warn('[_updateMintKeys]', 'Invalid mint keys to update, skipping', newKeys)
            return
        }
    
        const keyset = deriveKeysetId(newKeys)
        const mint = mintsStore.findByUrl(mintUrl)
    
        return mint?.updateKeys(keyset, newKeys) // TODO make only newKeys as param
    }


    // TODO: make it DRY with walletService
    const addCashuProofs = function (
        proofsToAdd: CashuProof[],
        mintUrl: string,
        transactionId: number,
        isPending: boolean = false    
    ): {  
        amountToAdd: number,  
        addedAmount: number,
        addedProofs: Proof[]
    } {
        // Add internal references
        for (const proof of proofsToAdd as Proof[]) {
            proof.tId = transactionId
            proof.mintUrl = mintUrl
        }
        
        const amountToAdd = CashuUtils.getProofsAmount(proofsToAdd as Proof[])    
        // Creates proper model instances and adds them to the wallet    
        const {addedAmount, addedProofs} = proofsStore.addProofs(proofsToAdd as Proof[], isPending)
                
        log.trace('[addCashuProofs]', 'Added recovered proofs to the wallet with amount', { amountToAdd, addedAmount, isPending })
    
        return {        
            amountToAdd,
            addedAmount,
            addedProofs
        }
    }

    // TODO: make it DRY with walletService
    const formatError = function (e: AppError) {
        return {
            name: e.name,
            message: e.message.slice(0, 100),
            params: e.params || {},
        } as AppError 
    }


    const onComplete = async () => {
        try {
            if(!seed || !mnemonic) {
                throw new AppError(Err.VALIDATION_ERROR, 'Missing mnemonic or seed.')
            }

            setStatusMessage('Recovering wallet address...')
            setIsLoading(true)
            
            await KeyChain.saveMnemonic(mnemonic)
            await KeyChain.saveSeed(seed as Uint8Array)

            // Wallet address recovery
            const seedHash = await KeyChain.loadSeedHash()

            log.trace('[onComplete]', 'getWalletProfileBySeedHash')
            const profileToRecover = await MinibitsClient.getWalletProfileBySeedHash(seedHash as string)            

            // Skip external profiles beacause we do not control keys
            if(profileToRecover) {
                log.info('[onComplete] recovery', {profileToRecover})
                setStatusMessage(`Found ${profileToRecover.nip05}`)

                if(profileToRecover.nip05.includes(MINIBITS_NIP05_DOMAIN)) {                                    
                    const {publicKey: newPublicKey} = await NostrClient.getOrCreateKeyPair()
                    // Updates pubkey and imports wallet profile
                    await walletProfileStore.recover(seedHash as string, newPublicKey)
                    // Align walletId in userSettings with recovered profile
                    userSettingsStore.setWalletId(walletProfileStore.walletId)                    
                    await delay(1000)
                    setStatusMessage(`Recovery completed`)
                    await delay(2000)
                } else {
                    setInfo(`You used wallet address ${profileToRecover.nip05} with your own keys, import it again.`)
                    await delay(5000)
                }
            }

            userSettingsStore.setIsOnboarded(true)
            setStatusMessage('')
            setIsLoading(false)
            navigation.navigate('Tabs')        
        } catch (e: any) {
            handleError(e)
        }
    }


    const handleError = function (e: AppError): void {
        setIsLoading(false)
        setError(e)
    }
    
    const headerBg = useThemeColor('header')
    const numIconColor = useThemeColor('textDim')
    const textHint = useThemeColor('textDim')
    const inputBg = useThemeColor('background')

    return (
      <Screen contentContainerStyle={$screen} preset="auto">
        <View style={[$headerContainer, {backgroundColor: headerBg}]}>            
            <Text preset="heading" text="Wallet recovery" style={{color: 'white', zIndex: 10}} />
        </View>

        <View style={$contentContainer}>
            {mnemonicExists ? (
            <Card
                style={$card}
                ContentComponent={
                    <ListItem
                        text='Mnemonic exists'
                        subText='Your wallet already has another mnemonic in its secure storage. Recovery process works only with freshly installed wallet to avoid loss of your funds.'
                        leftIcon='faTriangleExclamation'
                        // leftIconColor='red'                  
                        style={$item}                    
                        bottomSeparator={true}
                    /> 
                }
                FooterComponent={
                    <View style={$buttonContainer}>               
                        <Button
                            onPress={onBack}
                            text='Back'  
                            preset='secondary'                      
                        />                        
                    </View>                    
                }          
            />
            ) : (
                <>
                {isValidMnemonic ? (
                    <>
                    <Card
                        style={$card}
                        ContentComponent={
                            <ListItem
                                text='Your mnemonic phrase'
                                subText={mnemonic}
                                LeftComponent={<View style={[$numIcon, {backgroundColor: numIconColor}]}><Text text='1'/></View>}                  
                                style={$item}                            
                            /> 
                        }        
                    />
                    <Card
                        style={$card}
                        HeadingComponent={
                            <>
                            <ListItem
                                text='Recovery from mints'
                                subText='Identify mints to recover your ecash from and add them to the list.'
                                LeftComponent={<View style={[$numIcon, {backgroundColor: numIconColor}]}><Text text='2'/></View>} 
                                RightComponent={mintsStore.mintCount > 0 ? (
                                    <View style={$rightContainer}>
                                        <Button
                                            onPress={onAddMints}
                                            text='Mints'
                                            preset='secondary'                                           
                                        /> 
                                    </View>
                                    ) : (undefined)        
                                }                        
                                style={$item}                            
                            />
                            {mintsStore.mintCount === 0 && (
                                <View style={$buttonContainer}>
                                    <Button
                                        onPress={onAddMints}
                                        text='Add mints'                                            
                                    /> 
                                </View>
                            )}
                            </>
                        }
                        ContentComponent={
                            <>
                            {mintsStore.mints.map((mint: Mint, index: number) => (
                                <MintListItem
                                  key={mint.mintUrl}
                                  mint={mint}
                                  mintBalance={proofsStore.getMintBalance(mint.mintUrl)}
                                  // onMintSelect={() => onMintSelect(mint)}
                                  isSelectable={false}
                                  // isSelected={selectedMint?.mintUrl === mint.mintUrl}
                                  // isBlocked={mintsStore.isBlocked(mint.mintUrl as string)}                                  
                                  separator={index === 0 ? 'both' : 'bottom'}
                                />
                              ))}
                            </>
                        }
                        FooterComponent={
                            <>
                                {mintsStore.mintCount > 0 && (
                                <>
                                    <View style={$buttonContainer}> 
                                        {startIndex > 0 && (
                                            <Button
                                                onPress={onComplete}
                                                text={'Complete'}
                                                style={{marginRight: spacing.small}}                                        
                                            />
                                        )}               
                                        <Button
                                            onPress={startRecovery}
                                            text={startIndex === 0 ? 'Start recovery' : 'Next interval'}
                                            preset={startIndex === 0 ? 'default' : 'secondary'}    
                                        />                        
                                    </View>
                                    <Text 
                                        text={`Recovery interval ${startIndex} - ${endIndex}`} 
                                        size='xxs' 
                                        style={{color: textHint, alignSelf: 'center', marginTop: spacing.small}}
                                    />
                                </>  
                                )}
                            </>   
                        }         
                    />
                    </>
                ) : (
                <Card
                    style={$card}
                    ContentComponent={
                        <ListItem
                            text='Insert backup mnemonic phrase'
                            subText='Paste or rewrite 12 words phrase to recover your ecash balance on this device. Separate words by blank spaces.'
                            LeftComponent={<View style={[$numIcon, {backgroundColor: numIconColor}]}><Text text='1'/></View>}                  
                            style={$item}                            
                        /> 
                    }
                    FooterComponent={
                        <>
                        <TextInput
                            ref={mnemonicInputRef}
                            onChangeText={(mnemonic: string) => setMnemonic(mnemonic)}
                            value={mnemonic}
                            numberOfLines={3}
                            multiline={true}
                            autoCapitalize='none'
                            keyboardType='default'
                            maxLength={150}
                            placeholder='Mnemonic phrase...'
                            selectTextOnFocus={true}                    
                            style={[$mnemonicInput, {backgroundColor: inputBg, flexWrap: 'wrap'}]}
                        />
                        <View style={$buttonContainer}>
                            {mnemonic ? (
                                <Button
                                    onPress={onConfirm}
                                    text='Confirm'                        
                                />
                            ) : (
                                <Button
                                    onPress={onPaste}
                                    text='Paste'                        
                                />
                            )
                        }                    
                        </View>
                        </>
                    }           
                />
                )}                
            </>
            )}
        </View>
        <BottomModal
          isVisible={isErrorsModalVisible}
          style={{alignItems: 'stretch'}}          
          ContentComponent={
            <>
                {recoveryErrors?.map((err, index) => (
                        <ListItem
                            key={index}
                            leftIcon='faTriangleExclamation'
                            leftIconColor={colors.palette.angry500}                       
                            text={err.message}
                            subText={err.params ? err.params.mintUrl : ''}
                            bottomSeparator={true}
                            style={{paddingHorizontal: spacing.small}}
                        />             
                    )
                )}
            </>
          }
          onBackButtonPress={toggleErrorsModal}
          onBackdropPress={toggleErrorsModal}
        />
        <BottomModal
          isVisible={isResultModalVisible ? true : false}          
          ContentComponent={
            <>
              {resultModalInfo &&
                resultModalInfo.status === TransactionStatus.COMPLETED && (
                  <>
                    <ResultModalInfo
                      icon="faCheckCircle"
                      iconColor={colors.palette.success200}
                      title="Recovery success!"
                      message={resultModalInfo?.message}
                    />
                    <View style={$buttonContainer}>
                      <Button
                        preset="secondary"
                        tx={'common.close'}
                        onPress={toggleResultModal}
                      />
                    </View>
                  </>
                )}
              {resultModalInfo &&
                resultModalInfo.status === TransactionStatus.ERROR && (
                  <>
                    <ResultModalInfo
                      icon="faTriangleExclamation"
                      iconColor={colors.palette.angry500}
                      title="Recovery failed"
                      message={resultModalInfo?.message}
                    />
                    <View style={$buttonContainer}>
                      <Button
                        preset="secondary"
                        text={'Show errors'}
                        onPress={toggleErrorsModal}
                      />
                    </View>
                  </>
                )}
              {resultModalInfo &&
                resultModalInfo.status === TransactionStatus.EXPIRED && (
                  <>
                    <ResultModalInfo
                      icon='faInfoCircle'
                      iconColor={colors.palette.neutral400}
                      title="No ecash recovered"
                      message={resultModalInfo?.message}
                    />
                    <View style={$buttonContainer}>
                      <Button
                        preset="secondary"
                        tx={'common.close'}
                        onPress={toggleResultModal}
                      />
                    </View>
                  </>
                )}
            </>
          }
          onBackButtonPress={toggleResultModal}
          onBackdropPress={toggleResultModal}
        />             
        {error && <ErrorModal error={error} />}
        {info && <InfoModal message={info} />}
        {isLoading && <Loading statusMessage={statusMessage} style={{backgroundColor: headerBg, opacity: 1}}/>}    
      </Screen>
    )
})

const $screen: ViewStyle = {flex: 1}

const $headerContainer: TextStyle = {
  alignItems: 'center',
  padding: spacing.medium,
  height: spacing.screenHeight * 0.18,
}

const $contentContainer: TextStyle = {
    flex: 1,
    marginTop: -spacing.extraLarge * 2,
    padding: spacing.extraSmall,  
}

const $card: ViewStyle = {
  marginBottom: spacing.small,
}

const $numIcon: ViewStyle = {
    width: 30, 
    height: 30, 
    borderRadius: 15, 
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: spacing.medium
}

const $mnemonicInput: TextStyle = {
    // flex: 1,    
    borderRadius: spacing.small,    
    fontSize: 16,
    padding: spacing.small,
    alignSelf: 'stretch',
    textAlignVertical: 'top',
}

const $buttonContainer: ViewStyle = {
    flexDirection: 'row',
    alignSelf: 'center',
    marginTop: spacing.small,
}

const $bottomModal: ViewStyle = {
  flex: 1,
  alignItems: 'center',
  paddingVertical: spacing.large,
  paddingHorizontal: spacing.small,
}

const $item: ViewStyle = {
  paddingHorizontal: spacing.small,
  paddingLeft: 0,
}

const $rightContainer: ViewStyle = {
  // padding: spacing.extraSmall,
  alignSelf: 'center',
  //marginLeft: spacing.small,
}
